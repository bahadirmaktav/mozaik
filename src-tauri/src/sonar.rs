//! SonarQube (`docs/decisions/028-sonarqube.md`): the issues and Quality Gate of an analysis
//! that CI made, read from the server the user entered, only when the user connects or
//! refreshes. Every request is a GET; Mozaik changes nothing on the server, sends it no code
//! and runs no scanner. The token stays in the system's credential store and only goes to the
//! server it was entered for.

use crate::files::atomic_write;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard, PoisonError},
    time::Duration,
};
use tauri::Manager;

/// The issue search returns at most 10 000 results (`p × ps`); past that the result says so.
const PAGE_SIZE: usize = 500;
const MAX_ISSUES: usize = 10_000;
/// A larger answer is not a SonarQube answer Mozaik needs.
const MAX_BODY: usize = 32 * 1024 * 1024;
const MAX_PROPERTIES: u64 = 1024 * 1024;
const SERVICE: &str = "Mozaik SonarQube";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    url: String,
    project_key: String,
}

/// What the project's own `sonar-project.properties` says. Mozaik never writes it; a token in
/// it is never read, only noticed so the user can remove and revoke it.
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Properties {
    file: Option<String>,
    host_url: Option<String>,
    project_key: Option<String>,
    base_dir: Option<String>,
    has_token: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    binding: Option<Binding>,
    has_token: bool,
    /// The address is `http://`: the token would travel unencrypted.
    insecure: bool,
    properties: Properties,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Target {
    #[serde(rename_all = "camelCase")]
    PullRequest {
        key: String,
        title: String,
        branch: String,
        url: Option<String>,
    },
    Branch {
        name: String,
    },
    /// The main branch; its name is unknown when the server has no branch list.
    Main {
        name: Option<String>,
    },
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    start_line: u32,
    end_line: u32,
    start_offset: u32,
    end_offset: u32,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    key: String,
    rule: String,
    /// 1 error, 2 warning, 3 information, as the IDE's other problems.
    severity: u8,
    /// SonarQube's own severity, kept as it was.
    level: String,
    kind: Option<String>,
    message: String,
    /// The local file; `None` when the issue's file cannot be placed in the project.
    path: Option<String>,
    /// The file as SonarQube names it, relative to the analyzed folder.
    relative: String,
    /// Lines from 1, offsets in UTF-16 code units; `None` for an issue on a whole file.
    range: Option<Range>,
    effort: Option<String>,
    created: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    metric: String,
    comparator: Option<String>,
    threshold: Option<String>,
    actual: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QualityGate {
    /// `OK`, `WARN`, `ERROR` or `NONE`.
    status: String,
    /// The conditions that are not met.
    failing: Vec<Condition>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    target: Target,
    /// The commit the analysis read, when the server knows it.
    revision: Option<String>,
    analysis_date: Option<String>,
    quality_gate: Option<QualityGate>,
    issues: Vec<Issue>,
    total: usize,
    truncated: bool,
    /// Issues whose file is outside the project or unnamed.
    skipped: usize,
    /// The requests made and what went wrong, for Output → SonarQube (never the token).
    log: Vec<String>,
}

// ---- Validation ------------------------------------------------------------------------------

/// The server's address as Mozaik keeps it: `http(s)://host[:port][/context]`, no trailing
/// slash, no user, query or fragment.
fn server_url(text: &str) -> Result<String, String> {
    let url = Url::parse(text.trim())
        .map_err(|_| "Enter the server's address, as https://sonar.example.com".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("The server's address must start with https:// or http://".into());
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("The server's address has no host".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the user name out of the address; the token signs in".into());
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err("The server's address must not have a query or a fragment".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}
fn project_key(text: &str) -> Result<String, String> {
    let key = text.trim();
    if key.is_empty() || key.len() > 400 {
        return Err("Enter the project key (1–400 characters)".into());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
    {
        return Err("A project key has only letters, digits, '-', '_', '.' and ':'".into());
    }
    Ok(key.to_owned())
}
fn token(text: &str) -> Result<String, String> {
    let token = text.trim();
    if token.is_empty()
        || token.len() > 512
        || token.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err("The token is not valid: paste it as SonarQube showed it".into());
    }
    Ok(token.to_owned())
}
fn branch_name(text: &str) -> Option<String> {
    let name = text.trim();
    (!name.is_empty() && name.len() <= 255 && !name.chars().any(char::is_control) && name != "HEAD")
        .then(|| name.to_owned())
}

// ---- Stored bindings and the token -----------------------------------------------------------

static LOCK: Mutex<()> = Mutex::new(());
fn lock() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}
fn stored_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("sonar.json"))
}
fn stored(path: &Path) -> Result<BTreeMap<String, Binding>, String> {
    let Ok(bytes) = fs::read(path) else {
        return Ok(BTreeMap::new());
    };
    serde_json::from_slice(&bytes).map_err(|_| {
        format!(
            "The SonarQube connections file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
fn save(path: &Path, all: &BTreeMap<String, Binding>) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        path,
        &serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?,
    )
}
fn binding_of(app: &tauri::AppHandle, root: &Path) -> Result<Option<Binding>, String> {
    let _guard = lock();
    Ok(stored(&stored_path(app)?)?.remove(&crate::project::display(root)))
}

fn credential(url: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, url)
        .map_err(|e| format!("The system's credential store is not available: {e}"))
}
fn stored_token(url: &str) -> Result<Option<String>, String> {
    match credential(url)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!(
            "The token could not be read from the credential store: {e}"
        )),
    }
}
fn store_token(url: &str, token: &str) -> Result<(), String> {
    credential(url)?
        .set_password(token)
        .map_err(|e| format!("The token could not be kept in the credential store: {e}"))
}
fn forget_token(url: &str) -> Result<(), String> {
    match credential(url)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!(
            "The token could not be removed from the credential store: {e}"
        )),
    }
}

// ---- sonar-project.properties ----------------------------------------------------------------

/// The keys of a Java properties text (comments, `=`, `:` or blank separators, continued
/// lines and the usual escapes); later keys win, as in Java.
fn parse_properties(text: &str) -> BTreeMap<String, String> {
    let mut all = BTreeMap::new();
    let mut logical = String::new();
    for raw in text.lines() {
        // Leading blanks of a continued line are dropped too.
        let line = raw.trim_start();
        if logical.is_empty() && (line.is_empty() || line.starts_with('#') || line.starts_with('!'))
        {
            continue;
        }
        // An odd number of trailing backslashes continues the line.
        let trailing = line.chars().rev().take_while(|&c| c == '\\').count();
        if trailing % 2 == 1 {
            logical.push_str(&line[..line.len() - 1]);
            continue;
        }
        logical.push_str(line);
        let entry = std::mem::take(&mut logical);
        let (key, value) = split_property(&entry);
        if !key.is_empty() {
            all.insert(key, value);
        }
    }
    all
}
fn split_property(entry: &str) -> (String, String) {
    let mut key = String::new();
    let mut chars = entry.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(next) = chars.next() {
                    key.push(unescape(next));
                }
            }
            '=' | ':' => break,
            c if c.is_whitespace() => {
                while chars.peek().is_some_and(|c| c.is_whitespace()) {
                    chars.next();
                }
                if matches!(chars.peek(), Some('=' | ':')) {
                    chars.next();
                }
                break;
            }
            c => key.push(c),
        }
    }
    let rest: String = chars.collect();
    let mut value = String::new();
    let mut chars = rest.trim_start().chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                value.push(unescape(next));
            }
        } else {
            value.push(c);
        }
    }
    (key, value.trim_end().to_owned())
}
fn unescape(c: char) -> char {
    match c {
        't' => '\t',
        'n' => '\n',
        'r' => '\r',
        'f' => '\u{c}',
        c => c,
    }
}
/// A folder the properties name, inside the project; `None` for anything else.
fn inside(root: &Path, relative: &str) -> Option<PathBuf> {
    let path = Path::new(relative.trim());
    if relative.trim().is_empty() {
        return None;
    }
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let mut clean = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::ParentDir => {
                if !clean.pop() {
                    return None;
                }
            }
            Component::CurDir => {}
            other => clean.push(other),
        }
    }
    clean.starts_with(root).then_some(clean)
}
fn properties(root: &Path) -> Properties {
    let file = root.join("sonar-project.properties");
    let readable = fs::metadata(&file).is_ok_and(|m| m.is_file() && m.len() <= MAX_PROPERTIES);
    let Some(bytes) = readable.then(|| fs::read(&file).ok()).flatten() else {
        return Properties::default();
    };
    let all = parse_properties(&String::from_utf8_lossy(&bytes));
    let value = |key: &str| all.get(key).filter(|v| !v.is_empty()).cloned();
    Properties {
        file: Some(crate::project::display(&file)),
        host_url: value("sonar.host.url"),
        project_key: value("sonar.projectKey"),
        base_dir: value("sonar.projectBaseDir")
            .and_then(|dir| inside(root, &dir))
            .map(|dir| crate::project::display(&dir)),
        has_token: value("sonar.token").is_some() || value("sonar.login").is_some(),
    }
}
fn base_dir(root: &Path) -> PathBuf {
    properties(root)
        .base_dir
        .map(PathBuf::from)
        .unwrap_or_else(|| root.to_path_buf())
}

// ---- The server ------------------------------------------------------------------------------

struct Server {
    base: String,
    token: String,
    client: reqwest::Client,
}
#[derive(Debug)]
enum Failure {
    /// The server answered with an error status and its message.
    Status(StatusCode, String),
    Other(String),
}
impl Failure {
    fn text(&self) -> String {
        match self {
            Failure::Status(StatusCode::UNAUTHORIZED, _) => {
                "SonarQube refused the token (401). Create a user token under My Account → Security"
                    .into()
            }
            Failure::Status(StatusCode::FORBIDDEN, _) => {
                "The token may not read this project (403). Ask for Browse permission on it".into()
            }
            Failure::Status(status, message) if message.is_empty() => {
                format!("SonarQube answered {status}")
            }
            Failure::Status(status, message) => format!("SonarQube answered {status}: {message}"),
            Failure::Other(message) => message.clone(),
        }
    }
}
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}
fn reach(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(inner) = source {
        text = format!("{text}: {inner}");
        source = inner.source();
    }
    if error.is_timeout() {
        format!("SonarQube did not answer in time ({text})")
    } else {
        format!("SonarQube could not be reached ({text})")
    }
}
impl Server {
    fn new(base: &str, token: &str) -> Result<Self, String> {
        let origin = Url::parse(base).map_err(|e| e.to_string())?;
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            // A redirect may stay on the server (a context path); another host never gets the
            // token: the user enters that address instead.
            .redirect(reqwest::redirect::Policy::custom(move |attempt| {
                if attempt.previous().len() >= 5 {
                    attempt.error("too many redirects")
                } else if same_origin(attempt.url(), &origin) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .user_agent(concat!("Mozaik/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            base: base.to_owned(),
            token: token.to_owned(),
            client,
        })
    }
    async fn get(
        &self,
        path: &str,
        query: &[(&str, &str)],
        log: &mut Vec<String>,
    ) -> Result<Value, Failure> {
        let mut url = Url::parse(&format!("{}/{path}", self.base))
            .map_err(|e| Failure::Other(e.to_string()))?;
        url.query_pairs_mut().extend_pairs(query);
        log.push(format!(
            "GET {}{}",
            url.path(),
            url.query().map(|q| format!("?{q}")).unwrap_or_default()
        ));
        let mut response = self
            .client
            .get(url)
            .bearer_auth(&self.token)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| Failure::Other(reach(&e)))?;
        let status = response.status();
        if status.is_redirection() {
            let to = response
                .headers()
                .get("location")
                .and_then(|l| l.to_str().ok())
                .unwrap_or("another address");
            return Err(Failure::Other(format!(
                "SonarQube redirected to {to}; enter that address as the server instead"
            )));
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Failure::Other(reach(&e)))?
        {
            if body.len() + chunk.len() > MAX_BODY {
                return Err(Failure::Other("SonarQube's answer is too large".into()));
            }
            body.extend_from_slice(&chunk);
        }
        if !status.is_success() {
            let message = serde_json::from_slice::<Value>(&body)
                .ok()
                .and_then(|v| {
                    let errors = v.get("errors")?.as_array()?;
                    Some(
                        errors
                            .iter()
                            .filter_map(|e| e.get("msg")?.as_str())
                            .collect::<Vec<_>>()
                            .join("; "),
                    )
                })
                .unwrap_or_default();
            log.push(format!("  → {status} {message}"));
            return Err(Failure::Status(status, message));
        }
        serde_json::from_slice(&body).map_err(|_| {
            Failure::Other("The answer is not SonarQube's: check the server's address".into())
        })
    }
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::to_owned)
}
fn commit(value: &Value) -> Option<String> {
    text(value.get("commit")?, "sha")
}

/// The token and the project: what Connect checks before anything is kept.
async fn check(server: &Server, key: &str, log: &mut Vec<String>) -> Result<(), String> {
    let valid = server
        .get("api/authentication/validate", &[], log)
        .await
        .map_err(|f| f.text())?;
    if valid.get("valid").and_then(Value::as_bool) != Some(true) {
        return Err(
            "SonarQube refused the token. Create a user token under My Account → Security".into(),
        );
    }
    match server
        .get("api/components/show", &[("component", key)], log)
        .await
    {
        Ok(_) => Ok(()),
        Err(Failure::Status(StatusCode::NOT_FOUND, _)) => Err(format!(
            "SonarQube has no project {key}, or the token may not see it"
        )),
        Err(failure) => Err(failure.text()),
    }
}

/// The analysis to show: the pull request (merge request) of the local branch, that branch,
/// else the main branch. With `main_only` the main branch.
async fn target(
    server: &Server,
    key: &str,
    branch: Option<&str>,
    main_only: bool,
    log: &mut Vec<String>,
) -> (Target, Option<String>, Option<String>) {
    if let (Some(branch), false) = (branch, main_only)
        && let Ok(list) = server
            .get("api/project_pull_requests/list", &[("project", key)], log)
            .await
    {
        let latest = list
            .get("pullRequests")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|pr| text(pr, "branch").as_deref() == Some(branch))
            .max_by_key(|pr| text(pr, "analysisDate").unwrap_or_default());
        if let Some(pr) = latest {
            return (
                Target::PullRequest {
                    key: text(pr, "key").unwrap_or_default(),
                    title: text(pr, "title").unwrap_or_default(),
                    branch: branch.to_owned(),
                    url: text(pr, "url"),
                },
                commit(pr),
                text(pr, "analysisDate"),
            );
        }
    }
    let branches = server
        .get("api/project_branches/list", &[("project", key)], log)
        .await
        .ok();
    let list: Vec<&Value> = branches
        .as_ref()
        .and_then(|b| b.get("branches")?.as_array())
        .into_iter()
        .flatten()
        .collect();
    let main = list
        .iter()
        .find(|b| b.get("isMain").and_then(Value::as_bool) == Some(true));
    let own = branch.filter(|_| !main_only).and_then(|name| {
        list.iter().find(|b| {
            text(b, "name").as_deref() == Some(name)
                && b.get("isMain").and_then(Value::as_bool) != Some(true)
        })
    });
    let (found, chosen) = match (own, main) {
        (Some(b), _) => (
            Some(*b),
            Target::Branch {
                name: text(b, "name").unwrap_or_default(),
            },
        ),
        (None, Some(b)) => (
            Some(*b),
            Target::Main {
                name: text(b, "name"),
            },
        ),
        (None, None) => (None, Target::Main { name: None }),
    };
    let mut revision = found.and_then(commit);
    let mut date = found.and_then(|b| text(b, "analysisDate"));
    if revision.is_none() {
        // Servers that leave the commit out of the branch list have it in the analysis.
        let mut query = vec![("project", key), ("ps", "1")];
        let name = match &chosen {
            Target::Branch { name } => Some(name.clone()),
            Target::Main { name } => name.clone(),
            Target::PullRequest { .. } => None,
        };
        if let Some(name) = name.as_deref() {
            query.push(("branch", name));
        }
        if let Ok(found) = server.get("api/project_analyses/search", &query, log).await
            && let Some(analysis) = found
                .get("analyses")
                .and_then(Value::as_array)
                .and_then(|a| a.first())
        {
            revision = text(analysis, "revision");
            date = date.or_else(|| text(analysis, "date"));
        }
    }
    (chosen, revision, date)
}
fn target_query(target: &Target) -> Option<(&'static str, String)> {
    match target {
        Target::PullRequest { key, .. } => Some(("pullRequest", key.clone())),
        Target::Branch { name } => Some(("branch", name.clone())),
        Target::Main { .. } => None,
    }
}

/// SonarQube's severities as the IDE's 1–3, with the original text. The impacts of the
/// newer servers win over the older single severity.
fn severity(issue: &Value) -> (u8, String) {
    fn rank(level: &str) -> u8 {
        match level {
            "BLOCKER" | "HIGH" | "CRITICAL" => 1,
            "MEDIUM" | "MAJOR" => 2,
            _ => 3,
        }
    }
    let impacts: Vec<(String, String)> = issue
        .get("impacts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|i| {
            Some((
                text(i, "severity")?,
                text(i, "softwareQuality").unwrap_or_default(),
            ))
        })
        .collect();
    if let Some((level, quality)) = impacts.iter().min_by_key(|(level, _)| rank(level)) {
        let quality = quality.to_lowercase();
        let label = if quality.is_empty() {
            level.clone()
        } else {
            format!("{level} ({quality})")
        };
        return (rank(level), label);
    }
    let level = text(issue, "severity").unwrap_or_else(|| "INFO".into());
    (rank(&level), level)
}
/// The local file of an issue's component (`project:path/in/project`), inside the analyzed
/// folder; `None` when it is not a plain relative path.
fn local_path(base: &Path, key: &str, component: &str) -> Option<(PathBuf, String)> {
    let relative = component.strip_prefix(key)?.strip_prefix(':')?;
    let path = Path::new(relative);
    if relative.is_empty() || !path.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some((base.join(path), relative.to_owned()))
}
fn issue(base: &Path, key: &str, raw: &Value) -> Issue {
    let (severity, level) = severity(raw);
    let component = text(raw, "component").unwrap_or_default();
    let place = local_path(base, key, &component);
    let number = |v: &Value, k: &str| v.get(k).and_then(Value::as_u64).map(|n| n as u32);
    let range = raw.get("textRange").and_then(|r| {
        Some(Range {
            start_line: number(r, "startLine")?,
            end_line: number(r, "endLine")?,
            start_offset: number(r, "startOffset").unwrap_or(0),
            end_offset: number(r, "endOffset").unwrap_or(0),
        })
    });
    let range = range.or_else(|| {
        number(raw, "line").map(|line| Range {
            start_line: line,
            end_line: line,
            start_offset: 0,
            end_offset: 0,
        })
    });
    Issue {
        key: text(raw, "key").unwrap_or_default(),
        rule: text(raw, "rule").unwrap_or_default(),
        severity,
        level,
        kind: text(raw, "type"),
        message: text(raw, "message").unwrap_or_default(),
        path: place.as_ref().map(|(p, _)| crate::project::display(p)),
        relative: place.map(|(_, r)| r).unwrap_or_else(|| {
            component
                .rsplit_once(':')
                .map(|(_, r)| r.to_owned())
                .unwrap_or(component)
        }),
        range,
        effort: text(raw, "effort"),
        created: text(raw, "creationDate"),
    }
}

/// The open issues of the target, page by page up to the API's limit.
async fn issues(
    server: &Server,
    key: &str,
    target: &Target,
    base: &Path,
    log: &mut Vec<String>,
) -> Result<(Vec<Issue>, usize, bool), String> {
    let extra = target_query(target);
    // Older servers and SonarQube Cloud take `componentKeys`, newer ones also `components`.
    let mut parameter = "componentKeys";
    let mut found = Vec::new();
    let mut page = 1;
    let total = loop {
        let page_text = page.to_string();
        let size = PAGE_SIZE.to_string();
        let mut query = vec![
            (parameter, key),
            ("resolved", "false"),
            ("ps", size.as_str()),
            ("p", page_text.as_str()),
        ];
        if let Some((name, value)) = &extra {
            query.push((name, value.as_str()));
        }
        let answer = match server.get("api/issues/search", &query, log).await {
            Ok(answer) => answer,
            Err(Failure::Status(StatusCode::BAD_REQUEST, _))
                if page == 1 && parameter == "componentKeys" =>
            {
                parameter = "components";
                continue;
            }
            Err(failure) => return Err(failure.text()),
        };
        let total = answer
            .get("paging")
            .and_then(|p| p.get("total"))
            .or_else(|| answer.get("total"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as usize;
        let list = answer
            .get("issues")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let empty = list.is_empty();
        found.extend(list.iter().map(|raw| issue(base, key, raw)));
        if empty || found.len() >= total || page * PAGE_SIZE >= MAX_ISSUES {
            break total;
        }
        page += 1;
    };
    let truncated = total > found.len();
    Ok((found, total, truncated))
}

async fn quality_gate(
    server: &Server,
    key: &str,
    target: &Target,
    log: &mut Vec<String>,
) -> Option<QualityGate> {
    let extra = target_query(target);
    let mut query = vec![("projectKey", key)];
    if let Some((name, value)) = &extra {
        query.push((name, value.as_str()));
    }
    let answer = server
        .get("api/qualitygates/project_status", &query, log)
        .await
        .ok()?;
    let status = answer.get("projectStatus")?;
    Some(QualityGate {
        status: text(status, "status").unwrap_or_else(|| "NONE".into()),
        failing: status
            .get("conditions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|c| text(c, "status").as_deref() == Some("ERROR"))
            .map(|c| Condition {
                metric: text(c, "metricKey").unwrap_or_default(),
                comparator: text(c, "comparator"),
                threshold: text(c, "errorThreshold"),
                actual: text(c, "actualValue"),
            })
            .collect(),
    })
}

async fn fetch(
    server: &Server,
    key: &str,
    base: &Path,
    branch: Option<&str>,
    main_only: bool,
) -> Result<Fetched, String> {
    let mut log = Vec::new();
    let (target, revision, analysis_date) = target(server, key, branch, main_only, &mut log).await;
    let (all, total, truncated) = match issues(server, key, &target, base, &mut log).await {
        Ok(found) => found,
        Err(error) => {
            return Err(format!("{error}\n{}", log.join("\n")));
        }
    };
    let quality_gate = quality_gate(server, key, &target, &mut log).await;
    let skipped = all.iter().filter(|i| i.path.is_none()).count();
    Ok(Fetched {
        target,
        revision,
        analysis_date,
        quality_gate,
        issues: all,
        total,
        truncated,
        skipped,
        log,
    })
}

// ---- Commands --------------------------------------------------------------------------------

fn info(app: &tauri::AppHandle, root: &Path) -> Result<Info, String> {
    let binding = binding_of(app, root)?;
    let has_token = match &binding {
        Some(b) => stored_token(&b.url).unwrap_or(None).is_some(),
        None => false,
    };
    Ok(Info {
        insecure: binding
            .as_ref()
            .is_some_and(|b| b.url.starts_with("http://")),
        has_token,
        binding,
        properties: properties(root),
    })
}
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// The project's connection, its token's presence and what its properties file says.
#[tauri::command]
pub async fn sonar_info(app: tauri::AppHandle, root: String) -> Result<Info, String> {
    blocking(move || info(&app, &crate::project::root(&root)?)).await
}

/// Checks the token and the project, then keeps the connection (and a newly given token).
/// Without a token the one kept for that server is used.
#[tauri::command]
pub async fn sonar_connect(
    app: tauri::AppHandle,
    root: String,
    url: String,
    project_key: String,
    token: Option<String>,
) -> Result<Info, String> {
    let root = crate::project::root(&root)?;
    let url = server_url(&url)?;
    let key = self::project_key(&project_key)?;
    let given = token
        .filter(|t| !t.trim().is_empty())
        .map(|t| self::token(&t))
        .transpose()?;
    let lookup = url.clone();
    let token = match given.clone() {
        Some(token) => token,
        None => blocking(move || stored_token(&lookup))
            .await?
            .ok_or("Enter a token: none is kept for this server")?,
    };
    let server = Server::new(&url, &token)?;
    let mut log = Vec::new();
    check(&server, &key, &mut log).await?;
    blocking(move || {
        if let Some(token) = given {
            store_token(&url, &token)?;
        }
        let _guard = lock();
        let path = stored_path(&app)?;
        let mut all = stored(&path)?;
        all.insert(
            crate::project::display(&root),
            Binding {
                url,
                project_key: key,
            },
        );
        save(&path, &all)?;
        drop(_guard);
        info(&app, &root)
    })
    .await
}

/// Forgets the project's connection; the token goes too when no other project uses it.
#[tauri::command]
pub async fn sonar_disconnect(app: tauri::AppHandle, root: String) -> Result<Info, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        let _guard = lock();
        let path = stored_path(&app)?;
        let mut all = stored(&path)?;
        if let Some(binding) = all.remove(&crate::project::display(&root)) {
            save(&path, &all)?;
            if !all.values().any(|b| b.url == binding.url) {
                forget_token(&binding.url)?;
            }
        }
        drop(_guard);
        info(&app, &root)
    })
    .await
}

/// The issues and Quality Gate of the analysis for the local `branch` (its pull request, the
/// branch, else the main branch), or of the main branch with `main_only`.
#[tauri::command]
pub async fn sonar_fetch(
    app: tauri::AppHandle,
    root: String,
    branch: Option<String>,
    main_only: bool,
) -> Result<Fetched, String> {
    let root = crate::project::root(&root)?;
    let (binding, token, base) = {
        let root = root.clone();
        blocking(move || {
            let binding =
                binding_of(&app, &root)?.ok_or("Connect the project to SonarQube first")?;
            let token = stored_token(&binding.url)?
                .ok_or("No token is kept for this server: connect again with a token")?;
            Ok((binding, token, base_dir(&root)))
        })
        .await?
    };
    let server = Server::new(&binding.url, &token)?;
    let branch = branch.as_deref().and_then(branch_name);
    fetch(
        &server,
        &binding.project_key,
        &base,
        branch.as_deref(),
        main_only,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        sync::Arc,
    };

    type Query = BTreeMap<String, String>;
    /// Status, extra headers and body.
    type Answer = (u16, Vec<(String, String)>, String);
    type Route = dyn Fn(&str, &Query) -> Answer + Send + Sync;
    /// Path, query and Authorization header of each request.
    type Seen = Arc<Mutex<Vec<(String, Query, Option<String>)>>>;
    /// A SonarQube stand-in on 127.0.0.1: it answers each request from `route` and records
    /// what it was sent.
    struct Fake {
        url: String,
        requests: Seen,
    }
    fn fake(route: impl Fn(&str, &Query) -> Answer + Send + Sync + 'static) -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let seen = requests.clone();
        let route: Arc<Route> = Arc::new(route);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                if reader.read_line(&mut first).is_err() {
                    continue;
                }
                let mut auth = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                        break;
                    }
                    if let Some((name, value)) = line.split_once(':')
                        && name.eq_ignore_ascii_case("authorization")
                    {
                        auth = Some(value.trim().to_owned());
                    }
                }
                let target = first.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let parsed = Url::parse(&format!("http://fake{target}")).unwrap();
                let query: BTreeMap<String, String> = parsed.query_pairs().into_owned().collect();
                seen.lock()
                    .unwrap()
                    .push((parsed.path().to_owned(), query.clone(), auth));
                let (code, headers, body) = route(parsed.path(), &query);
                let mut answer = format!(
                    "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                    body.len()
                );
                for (name, value) in headers {
                    answer.push_str(&format!("{name}: {value}\r\n"));
                }
                answer.push_str("\r\n");
                answer.push_str(&body);
                let _ = stream.write_all(answer.as_bytes());
            }
        });
        Fake { url, requests }
    }
    fn ok(body: &str) -> (u16, Vec<(String, String)>, String) {
        (200, Vec::new(), body.to_owned())
    }
    fn run<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }
    /// An issue as SonarQube Cloud sent it (copied from a public project, shortened).
    fn raw_issue(key: &str, path: &str, line: u32) -> String {
        format!(
            r#"{{"key":"{key}","rule":"cpp:S6009","severity":"MINOR","component":"proj:{path}","project":"proj","line":{line},"hash":"c89e","textRange":{{"startLine":{line},"endLine":{line},"startOffset":17,"endOffset":42}},"flows":[],"status":"OPEN","message":"Replace this const reference to \"std::string\" by a \"std::string_view\".","effort":"2min","type":"CODE_SMELL","impacts":[{{"softwareQuality":"MAINTAINABILITY","severity":"LOW"}}],"creationDate":"2026-04-26T09:47:20+0000"}}"#
        )
    }

    #[test]
    fn addresses_keys_and_tokens_are_checked() {
        assert_eq!(
            server_url(" https://sonar.example.com/ ").unwrap(),
            "https://sonar.example.com"
        );
        assert_eq!(
            server_url("http://10.0.0.5:9000/sonarqube/").unwrap(),
            "http://10.0.0.5:9000/sonarqube"
        );
        for bad in [
            "sonar.example.com",
            "ftp://sonar",
            "https://user:pw@sonar",
            "https://sonar?x=1",
            "https://sonar#a",
        ] {
            assert!(server_url(bad).is_err(), "{bad}");
        }
        assert_eq!(project_key(" my_org:proj-1.2 ").unwrap(), "my_org:proj-1.2");
        assert!(project_key("a b").is_err());
        assert!(project_key("").is_err());
        assert!(token("squ_abc123").is_ok());
        assert!(token("squ abc").is_err());
        assert_eq!(branch_name("feature/x"), Some("feature/x".into()));
        assert_eq!(branch_name("HEAD"), None);
        assert_eq!(branch_name(" "), None);
    }

    #[test]
    fn properties_give_the_key_the_address_and_the_folder_but_never_a_token() {
        let text = "# comment\n! also\nsonar.projectKey = mozaik\nsonar.host.url: https://sonar.local\nsonar.sources=src,\\\n    include\nsonar.projectBaseDir=code\nsonar.token=squ_secret\nkey\\ with\\=escapes value\n";
        let all = parse_properties(text);
        assert_eq!(all["sonar.projectKey"], "mozaik");
        assert_eq!(all["sonar.host.url"], "https://sonar.local");
        assert_eq!(all["sonar.sources"], "src,include");
        assert_eq!(all["key with=escapes"], "value");

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("code")).unwrap();
        fs::write(root.join("sonar-project.properties"), text).unwrap();
        let found = properties(&root);
        assert_eq!(found.project_key.as_deref(), Some("mozaik"));
        assert_eq!(found.host_url.as_deref(), Some("https://sonar.local"));
        assert_eq!(
            found.base_dir,
            Some(crate::project::display(&root.join("code")))
        );
        assert!(found.has_token);
        // The token's value is not part of what Mozaik keeps or shows.
        assert!(!format!("{found:?}").contains("squ_secret"));

        fs::write(
            root.join("sonar-project.properties"),
            "sonar.projectBaseDir=../elsewhere\n",
        )
        .unwrap();
        assert_eq!(properties(&root).base_dir, None);
        assert_eq!(base_dir(&root), root);
    }

    #[test]
    fn issue_files_stay_inside_the_analyzed_folder() {
        let base = Path::new("/work/project");
        assert_eq!(
            local_path(base, "proj", "proj:src/a.cpp"),
            Some((base.join("src/a.cpp"), "src/a.cpp".into()))
        );
        assert_eq!(local_path(base, "proj", "proj:../secret.txt"), None);
        assert_eq!(local_path(base, "proj", "proj:/etc/passwd"), None);
        assert_eq!(local_path(base, "proj", "other:src/a.cpp"), None);
        assert_eq!(local_path(base, "proj", "proj"), None);
    }

    #[test]
    fn severities_keep_their_original_name() {
        let impact: Value = serde_json::from_str(r#"{"severity":"MINOR","impacts":[{"softwareQuality":"MAINTAINABILITY","severity":"LOW"},{"softwareQuality":"RELIABILITY","severity":"HIGH"}]}"#).unwrap();
        assert_eq!(severity(&impact), (1, "HIGH (reliability)".into()));
        let old: Value = serde_json::from_str(r#"{"severity":"MAJOR"}"#).unwrap();
        assert_eq!(severity(&old), (2, "MAJOR".into()));
        let none: Value = serde_json::from_str("{}").unwrap();
        assert_eq!(severity(&none), (3, "INFO".into()));
    }

    #[test]
    fn the_merge_request_of_the_local_branch_is_chosen_with_its_commit() {
        let server = fake(|path, query| match path {
            "/api/project_pull_requests/list" => ok(r#"{"pullRequests":[
                {"key":"41","title":"Old","branch":"feature/x","analysisDate":"2026-11-01T09:00:00+0000","commit":{"sha":"aaaa111"}},
                {"key":"42","title":"Fix parser","branch":"feature/x","analysisDate":"2026-11-07T09:36:55+0000","url":"https://git/mr/42","commit":{"sha":"60f6d77f3097c80c87891616cc32d7b447335961"}},
                {"key":"7","title":"Other","branch":"feature/y","analysisDate":"2026-11-08T00:00:00+0000","commit":{"sha":"bbbb"}}]}"#),
            "/api/issues/search" => {
                assert_eq!(query.get("pullRequest").map(String::as_str), Some("42"));
                assert_eq!(query.get("resolved").map(String::as_str), Some("false"));
                ok(&format!(
                    r#"{{"paging":{{"pageIndex":1,"pageSize":500,"total":1}},"issues":[{}]}}"#,
                    raw_issue("AZ1", "src/a.cpp", 40)
                ))
            }
            "/api/qualitygates/project_status" => {
                ok(r#"{"projectStatus":{"status":"ERROR","conditions":[
                {"status":"OK","metricKey":"new_bugs","comparator":"GT","errorThreshold":"0","actualValue":"0"},
                {"status":"ERROR","metricKey":"new_code_smells","comparator":"GT","errorThreshold":"0","actualValue":"1"}]}}"#)
            }
            _ => (
                404,
                Vec::new(),
                r#"{"errors":[{"msg":"Unknown url"}]}"#.into(),
            ),
        });
        let s = Server::new(&server.url, "squ_token").unwrap();
        let base = Path::new("/work/project");
        let fetched = run(fetch(&s, "proj", base, Some("feature/x"), false)).unwrap();
        assert_eq!(
            fetched.target,
            Target::PullRequest {
                key: "42".into(),
                title: "Fix parser".into(),
                branch: "feature/x".into(),
                url: Some("https://git/mr/42".into())
            }
        );
        assert_eq!(
            fetched.revision.as_deref(),
            Some("60f6d77f3097c80c87891616cc32d7b447335961")
        );
        assert_eq!(fetched.issues.len(), 1);
        let issue = &fetched.issues[0];
        assert_eq!(
            issue.path,
            Some(crate::project::display(&base.join("src/a.cpp")))
        );
        assert_eq!(
            issue.range,
            Some(Range {
                start_line: 40,
                end_line: 40,
                start_offset: 17,
                end_offset: 42
            })
        );
        assert_eq!(
            (issue.severity, issue.level.as_str()),
            (3, "LOW (maintainability)")
        );
        let gate = fetched.quality_gate.unwrap();
        assert_eq!(gate.status, "ERROR");
        assert_eq!(gate.failing.len(), 1);
        assert_eq!(gate.failing[0].metric, "new_code_smells");
        // Every request carried the token, and nothing but GETs to this server were made.
        let requests = server.requests.lock().unwrap();
        assert!(
            requests
                .iter()
                .all(|(_, _, auth)| auth.as_deref() == Some("Bearer squ_token"))
        );
        assert!(
            fetched
                .log
                .iter()
                .all(|line| line.starts_with("GET ") || line.starts_with("  →"))
        );
        assert!(!fetched.log.join("\n").contains("squ_token"));
    }

    #[test]
    fn without_a_merge_request_the_branch_then_the_main_branch_is_used() {
        let server = fake(|path, query| match path {
            "/api/project_pull_requests/list" => ok(r#"{"pullRequests":[]}"#),
            "/api/project_branches/list" => ok(r#"{"branches":[
                {"name":"main","isMain":true,"analysisDate":"2026-04-29T19:04:26+0000","commit":{"sha":"e5c628bd"}},
                {"name":"feature/x","isMain":false,"analysisDate":"2026-04-30T10:00:00+0000"}]}"#),
            "/api/project_analyses/search" => {
                assert_eq!(query.get("branch").map(String::as_str), Some("feature/x"));
                ok(
                    r#"{"analyses":[{"key":"a","date":"2026-04-30T10:00:00+0000","revision":"cafe1234"}]}"#,
                )
            }
            "/api/issues/search" => ok(r#"{"paging":{"total":0},"issues":[]}"#),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        let fetched = run(fetch(&s, "proj", Path::new("/p"), Some("feature/x"), false)).unwrap();
        assert_eq!(
            fetched.target,
            Target::Branch {
                name: "feature/x".into()
            }
        );
        assert_eq!(fetched.revision.as_deref(), Some("cafe1234"));
        // A branch the server does not know shows the main branch and its commit.
        let fetched = run(fetch(
            &s,
            "proj",
            Path::new("/p"),
            Some("local-only"),
            false,
        ))
        .unwrap();
        assert_eq!(
            fetched.target,
            Target::Main {
                name: Some("main".into())
            }
        );
        assert_eq!(fetched.revision.as_deref(), Some("e5c628bd"));
        // As asked: the main branch even on a branch with its own analysis.
        let fetched = run(fetch(&s, "proj", Path::new("/p"), Some("feature/x"), true)).unwrap();
        assert_eq!(
            fetched.target,
            Target::Main {
                name: Some("main".into())
            }
        );
    }

    #[test]
    fn a_server_without_branches_shows_its_one_analysis() {
        // Community Build: no pull requests or branch list for this project.
        let server = fake(|path, _| match path {
            "/api/project_pull_requests/list" | "/api/project_branches/list" => (
                400,
                Vec::new(),
                r#"{"errors":[{"msg":"Not supported"}]}"#.into(),
            ),
            "/api/project_analyses/search" => {
                ok(r#"{"analyses":[{"date":"2026-01-01T00:00:00+0000","revision":"abc1234"}]}"#)
            }
            "/api/issues/search" => ok(r#"{"paging":{"total":0},"issues":[]}"#),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        let fetched = run(fetch(&s, "proj", Path::new("/p"), Some("feature/x"), false)).unwrap();
        assert_eq!(fetched.target, Target::Main { name: None });
        assert_eq!(fetched.revision.as_deref(), Some("abc1234"));
        assert_eq!(
            fetched.analysis_date.as_deref(),
            Some("2026-01-01T00:00:00+0000")
        );
    }

    #[test]
    fn issues_are_read_page_by_page_up_to_the_limit() {
        let server = fake(|path, query| match path {
            "/api/issues/search" => {
                let page: usize = query["p"].parse().unwrap();
                let size: usize = query["ps"].parse().unwrap();
                let list: Vec<String> = (0..size)
                    .map(|i| raw_issue(&format!("K{page}-{i}"), "a.cpp", 1))
                    .collect();
                ok(&format!(
                    r#"{{"paging":{{"total":12345}},"issues":[{}]}}"#,
                    list.join(",")
                ))
            }
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        let (found, total, truncated) = run(issues(
            &s,
            "proj",
            &Target::Main { name: None },
            Path::new("/p"),
            &mut Vec::new(),
        ))
        .unwrap();
        assert_eq!(found.len(), MAX_ISSUES);
        assert_eq!(total, 12345);
        assert!(truncated);
        assert_eq!(
            server.requests.lock().unwrap().len(),
            MAX_ISSUES / PAGE_SIZE
        );
    }

    #[test]
    fn a_server_that_wants_components_gets_it() {
        let server = fake(|path, query| match path {
            "/api/issues/search" if query.contains_key("componentKeys") => (
                400,
                Vec::new(),
                r#"{"errors":[{"msg":"The 'components' parameter is missing"}]}"#.into(),
            ),
            "/api/issues/search" => {
                assert_eq!(query.get("components").map(String::as_str), Some("proj"));
                ok(&format!(
                    r#"{{"paging":{{"total":1}},"issues":[{}]}}"#,
                    raw_issue("A", "a.cpp", 3)
                ))
            }
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        let (found, _, _) = run(issues(
            &s,
            "proj",
            &Target::Main { name: None },
            Path::new("/p"),
            &mut Vec::new(),
        ))
        .unwrap();
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn connect_checks_the_token_and_the_project() {
        let server = fake(|path, query| match path {
            "/api/authentication/validate" => ok(r#"{"valid":true}"#),
            "/api/components/show" if query["component"] == "proj" => {
                ok(r#"{"component":{"key":"proj"}}"#)
            }
            "/api/components/show" => (
                404,
                Vec::new(),
                r#"{"errors":[{"msg":"Component key 'x' not found"}]}"#.into(),
            ),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        assert!(run(check(&s, "proj", &mut Vec::new())).is_ok());
        let missing = run(check(&s, "other", &mut Vec::new())).unwrap_err();
        assert!(missing.contains("no project other"), "{missing}");

        let refused = fake(|path, _| match path {
            "/api/authentication/validate" => ok(r#"{"valid":false}"#),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&refused.url, "bad").unwrap();
        assert!(
            run(check(&s, "proj", &mut Vec::new()))
                .unwrap_err()
                .contains("refused the token")
        );
    }

    #[test]
    fn errors_say_what_to_do() {
        let server = fake(|path, _| match path {
            "/api/issues/search" => (401, Vec::new(), String::new()),
            "/api/qualitygates/project_status" => (403, Vec::new(), String::new()),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        let error = run(fetch(&s, "proj", Path::new("/p"), None, false)).unwrap_err();
        assert!(error.contains("refused the token (401)"), "{error}");

        // Nothing listens: the connection fails with a clear message instead of hanging.
        let closed = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            format!("http://{}", listener.local_addr().unwrap())
        };
        let s = Server::new(&closed, "t").unwrap();
        let error = run(fetch(&s, "proj", Path::new("/p"), None, false)).unwrap_err();
        assert!(error.contains("could not be reached"), "{error}");
    }

    #[test]
    fn the_token_never_follows_a_redirect_to_another_server() {
        let other = fake(|_, _| ok(r#"{"valid":true}"#));
        let target = format!("{}/api/authentication/validate", other.url);
        let server = fake(move |path, _| match path {
            "/api/authentication/validate" => (
                302,
                vec![("Location".into(), target.clone())],
                String::new(),
            ),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "squ_secret").unwrap();
        let error = run(check(&s, "proj", &mut Vec::new())).unwrap_err();
        assert!(error.contains("redirected to"), "{error}");
        assert!(other.requests.lock().unwrap().is_empty());
    }

    #[test]
    fn a_redirect_on_the_same_server_is_followed() {
        let server = fake(|path, _| match path {
            "/api/authentication/validate" => (
                301,
                vec![(
                    "Location".into(),
                    "/sonar/api/authentication/validate".into(),
                )],
                String::new(),
            ),
            "/sonar/api/authentication/validate" => ok(r#"{"valid":true}"#),
            "/api/components/show" => ok("{}"),
            _ => (404, Vec::new(), "{}".into()),
        });
        let s = Server::new(&server.url, "t").unwrap();
        assert!(run(check(&s, "proj", &mut Vec::new())).is_ok());
    }

    #[test]
    fn an_answer_that_is_not_json_points_at_the_address() {
        let server = fake(|_, _| ok("<html>login</html>"));
        let s = Server::new(&server.url, "t").unwrap();
        let error = run(check(&s, "proj", &mut Vec::new())).unwrap_err();
        assert!(error.contains("not SonarQube's"), "{error}");
    }
}
