# 028 — SonarQube: the server's analysis in the IDE

Status: accepted (2026-11-07). Changes decision [017](017-code-analysis.md) ("SonarQube,
Connected Mode … out of scope") and makes one exception to the offline rule of `AGENTS.md`.

## Context

The user wanted SonarQube in the IDE as SonarQube for IDE works in VS Code: a server address,
a project and a token, findings in a view of the activity bar, in the editor and in Problems.
Their CI analyzes merge requests and the main branch after a merge.

Two ways to analyze locally were checked and are closed:

- **SonarQube for IDE's engine.** Connected Mode does not move the analysis to the server: the
  extension analyzes locally with the CFamily analyzer, and the server supplies rules and issue
  states. The `NOTICE.txt` of SonarQube for IDE 6.1.0 (installed on the development machine)
  licenses `sonar-cfamily-plugin` "solely as part of this program" and prohibits other use. So
  Mozaik does not start, copy or download it; stage 2 of 017 stays closed for C and C++.
- **SonarScanner without publishing.** The scanner's preview/issues mode, which analyzed
  without storing a result, was removed in SonarQube 7.x. Every scan is stored on the server
  (on the main branch of a Community Build, over the CI's result). The user chose not to scan
  from Mozaik: CI analyzes and stores, Mozaik reads.

## Decisions

- **Read only.** `src-tauri/src/sonar.rs` sends GET requests to the server the user entered,
  only on Connect and Refresh: no polling, no notifications, no background requests, no code
  sent, nothing changed on the server, no scanner or other process. Without a connection no
  request is made. The renderer cannot reach the network (CSP and capabilities are unchanged);
  every request goes through Rust. This is the one exception to "no implicit network
  requests": the requests are explicit, to the user's own server.
- **Token.** A SonarQube user token, kept in the system's credential store (`keyring`: the
  Windows Credential Manager, the Secret Service on Linux through zbus); without one the
  connection fails, there is no plaintext fallback. The renderer sends it once and gets back
  only whether one is kept. It is sent as a Bearer header and never logged. A redirect is
  followed only on the same scheme, host and port, so the token never reaches another
  server; another address is reported for the user to enter. TLS uses the system's TLS and
  certificate store (SChannel on Windows, OpenSSL on Linux), so a company CA the system trusts
  works; there is no "ignore certificate" option. An `http://` address shows a warning.
- **Where things live.** The address and project key per project in app config `sonar.json`
  (not in the repository). `sonar-project.properties` stays the user's: Mozaik only reads
  `sonar.host.url` and `sonar.projectKey` (to fill in the form) and `sonar.projectBaseDir`
  (the folder issue paths are relative to). A `sonar.token` or `sonar.login` in it is never
  read; the view asks to remove and revoke it. `.sonarlint` is not read.
- **Which analysis.** The local branch (Git's) chooses: its pull/merge request
  (`api/project_pull_requests/list`, the latest with that `branch`), else the same branch
  (`api/project_branches/list`), else the main branch; "Main branch" in the view forces the
  last. A server without these lists (Community Build) shows its one analysis. The analyzed
  commit is the list's `commit.sha` (for a pull request this is the only reliable source:
  `api/project_analyses/search` ignores `pullRequest` on SonarQube Cloud), else the latest
  analysis' `revision`. Issues: `api/issues/search`, unresolved, 500 per page up to the API's
  10 000 (the view says when more exist); `componentKeys`, or `components` when the server
  refuses it. Quality Gate: `api/qualitygates/project_status`. Severities map to error,
  warning and information (impacts first, else the older severity); the original stays.
- **Matching the working tree.** Each issue is placed through Git (read-only `git_has_commit`,
  `git_revision_text`, `git_changed_since` in `git.rs`; commit names are 7–64 hex digits):
  files unchanged since the analyzed commit and not edited show issues where they are; other
  files compare the analyzed text with the current one (the editor's, unsaved edits included)
  line by line with the Git gutter's diff. An issue whose lines are all kept, in one piece,
  moves with them; one whose lines changed is **Changed, awaiting CI** (not drawn in the
  editor, faded in Problems), since only the next analysis can tell whether it is fixed; without
  the commit (not fetched, rebased, a merged-results pipeline's merge commit) all are
  **Unmatched**. Typing and Git changes place them again without a request.
- **Refreshes compared.** A refresh of the same target compares issue keys with the one before:
  "n fixed, m new", the new ones marked. Kept in the window's memory only.
- **Where they show.** The SonarQube view in the activity bar (connection form, target, commit
  and age, Quality Gate, issues by track and file, severity filter), Problems (source
  `SonarQube`, grouped with the others as in 017) and the code editor. The editor's problems
  are now drawn by one function (`lint.ts`) that joins the language server's diagnostics and
  these marks, also in files without a language server. Output → SonarQube lists the requests.
  The feature can be turned off in Settings → IDE → Features.

## Not done

- Scanning from Mozaik, analysis while typing (the CFamily licence), SonarQube Cloud's
  organization, hotspots, issue transitions (Accept, False Positive), rule descriptions,
  coverage or duplication figures, `.sonarlint` bindings, a status bar item.
- Choosing the pull request's source commit when the analyzed commit is a merge commit that
  is not local; to be decided with a real merged-results pipeline.

## Verification

Rust tests use a stand-in server on 127.0.0.1 whose answers follow responses read from
SonarQube Cloud's public API (issues, pull requests, branches, analyses, Quality Gate); a
real temporary Git repository covers the matching commands. A browser test covers the view,
Problems, the editor marks, tracking while editing and comparing refreshes. A real SonarQube
Server, the credential stores, a company CA and a real merge request are not exercised; see
`docs/VALIDATION.md`.
