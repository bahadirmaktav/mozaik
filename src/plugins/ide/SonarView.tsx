import { useEffect, useState } from "react";
import { CloseIcon, FilesIcon, RefreshIcon } from "../../components/Icons";
import { host, reveal } from "./editors";
import { relative } from "./paths";
import type { Project } from "./projects";
import { useSectionState } from "./Sections";
import {
  connect,
  disconnect,
  loadInfo,
  refresh,
  setMainOnly,
  useSonar,
} from "./sonar";
import {
  groupPlaced,
  targetLabel,
  type Placed,
  type Track,
} from "./sonarModel";

const SEVERITY = ["", "Error", "Warning", "Info"];
const TRACKS: { id: Track; title: string; hint: string }[] = [
  {
    id: "open",
    title: "Open",
    hint: "Issues whose lines are as the analysis read them, perhaps moved by edits around them.",
  },
  {
    id: "changed",
    title: "Changed, awaiting CI",
    hint: "You edited these lines since the analysis. The next analysis tells whether the issue is gone.",
  },
  {
    id: "unmatched",
    title: "Unmatched",
    hint: "The analyzed commit or the file is not in this working tree.",
  },
];
const GATE: Record<string, string> = {
  OK: "Passed",
  ERROR: "Failed",
  WARN: "Warning",
  NONE: "None",
};
function ago(date: string | null) {
  if (!date) return "";
  const time = Date.parse(date.replace(/([+-]\d\d)(\d\d)$/, "$1:$2"));
  if (Number.isNaN(time)) return date;
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(time).toLocaleDateString();
}

function ConnectForm({ project }: { project: Project }) {
  const state = useSonar(project.id);
  const props = state.info?.properties;
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  // The project's own properties file fills in what it names, once known.
  useEffect(() => {
    if (props?.hostUrl) setUrl((v) => v || props.hostUrl!);
    if (props?.projectKey) setKey((v) => v || props.projectKey!);
  }, [props?.hostUrl, props?.projectKey]);
  const busy = state.busy === "connecting";
  return (
    <form
      className="sonar-form"
      onSubmit={(event) => {
        event.preventDefault();
        void connect(project.id, url, key, token).then(() => setToken(""));
      }}
    >
      <p className="project-hint">
        Shows the issues and Quality Gate of the analysis your CI made: of this
        branch's merge request, else the branch, else the main branch. Mozaik
        only reads from the server, when you connect or refresh.
      </p>
      <label>
        Server URL
        <input
          className="sonar-input"
          value={url}
          placeholder="https://sonarqube.example.com"
          spellCheck={false}
          onChange={(e) => setUrl(e.target.value)}
        />
      </label>
      <label>
        Project key
        <input
          className="sonar-input"
          value={key}
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label>
        Token
        <input
          className="sonar-input"
          type="password"
          value={token}
          autoComplete="off"
          placeholder={state.info?.hasToken ? "Kept for this server" : "squ_…"}
          onChange={(e) => setToken(e.target.value)}
        />
      </label>
      <p className="sonar-note">
        A user token from SonarQube's My Account → Security. It is kept in the
        system's credential store, never in the project.
      </p>
      {props?.hasToken && <TokenInFile />}
      {state.error && (
        <p className="project-error" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        className="project-open"
        disabled={busy || !url.trim() || !key.trim()}
      >
        {busy ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}
function TokenInFile() {
  return (
    <p className="sonar-warning" role="note">
      sonar-project.properties contains a token. Mozaik does not read it: remove
      it from the file and revoke it in SonarQube, since it is in the
      repository's history.
    </p>
  );
}

function IssueRow({ item, isNew }: { item: Placed; isNew: boolean }) {
  const { issue, range, track } = item;
  const line = range.start.line + 1;
  return (
    <li>
      <button
        type="button"
        className={`todo-item problem severity-${issue.severity}${track === "open" ? "" : " sonar-stale"}`}
        style={{ paddingLeft: 38 }}
        title={`${issue.message}\n${issue.rule} · ${issue.level}${issue.effort ? ` · ${issue.effort}` : ""}`}
        disabled={!issue.path}
        onClick={() =>
          issue.path &&
          void reveal(issue.path, range.start).catch((e) => host().report(e))
        }
      >
        <span className="problem-severity">{SEVERITY[issue.severity]}</span>
        <span className="todo-text">{issue.message}</span>
        {isNew && <span className="sonar-new">new</span>}
        <span className="todo-place">
          {issue.range ? `${line}:${range.start.character + 1}` : "file"}
        </span>
      </button>
    </li>
  );
}

/**
 * The SonarQube view: the connection form, then the analysis shown (merge request, branch or
 * main branch, its commit and age), its Quality Gate, what changed since the last refresh and
 * the issues by how they match the working tree, by file.
 */
export function Sonar({ project }: { project: Project }) {
  const state = useSonar(project.id);
  const { closed, toggle } = useSectionState(project, "sonar", ["unmatched"]);
  const [severity, setSeverity] = useState<0 | 1 | 2 | 3>(0);
  const root = project.root ?? "";
  useEffect(() => {
    if (!state.info) void loadInfo(project.id);
  }, [project.id, state.info]);
  const binding = state.info?.binding;
  if (!state.info)
    return (
      <div className="todo-view">
        {state.error ? (
          <p className="project-error" role="alert">
            {state.error}
          </p>
        ) : (
          <p className="project-hint">Loading…</p>
        )}
      </div>
    );
  if (!binding)
    return (
      <div className="todo-view sonar-view">
        <ConnectForm project={project} />
      </div>
    );
  const fetched = state.fetched;
  const groups = groupPlaced(state.placed, severity);
  const counts = {
    open: state.placed.filter((p) => p.track === "open").length,
    changed: state.placed.filter((p) => p.track === "changed").length,
  };
  const gate = fetched?.qualityGate;
  const properties = state.info.properties;
  return (
    <div className="todo-view sonar-view">
      <div className="todo-bar">
        <span
          className="muted"
          title={`${binding.url} · ${binding.projectKey}`}
        >
          {state.busy === "refreshing"
            ? "Reading the analysis…"
            : fetched
              ? `${counts.open} open · ${counts.changed} changed`
              : binding.projectKey}
        </span>
        <select
          className="sonar-filter"
          aria-label="Severity"
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value) as 0 | 1 | 2 | 3)}
        >
          <option value={0}>All</option>
          <option value={1}>Errors</option>
          <option value={2}>Warnings and up</option>
        </select>
        <button
          type="button"
          aria-label="Refresh SonarQube Results"
          title="Refresh (reads the latest analysis from the server)"
          disabled={state.busy !== null}
          onClick={() => void refresh(project.id)}
        >
          <RefreshIcon />
        </button>
        {properties.file && (
          <button
            type="button"
            aria-label="Open sonar-project.properties"
            title="Open sonar-project.properties"
            onClick={() =>
              void reveal(properties.file!, 0).catch((e) => host().report(e))
            }
          >
            <FilesIcon />
          </button>
        )}
        <button
          type="button"
          aria-label="Disconnect from SonarQube"
          title="Disconnect from SonarQube…"
          disabled={state.busy !== null}
          onClick={() => void disconnect(project.id)}
        >
          <CloseIcon />
        </button>
      </div>
      <p className="coverage-source" title={binding.url}>
        {binding.projectKey} · {binding.url.replace(/^https?:\/\//, "")}
      </p>
      <label className="sonar-check">
        <input
          type="checkbox"
          checked={state.mainOnly}
          disabled={state.busy !== null}
          onChange={(e) => setMainOnly(project.id, e.target.checked)}
        />
        Main branch, not this branch's merge request
      </label>
      {state.info.insecure && (
        <p className="sonar-warning" role="note">
          The server's address is http://: the token travels unencrypted.
        </p>
      )}
      {properties.hasToken && <TokenInFile />}
      {state.error && (
        <p className="project-error" role="alert">
          {state.error}
        </p>
      )}
      {!fetched && state.busy === null && !state.error && (
        <div className="project-hint">
          <p>Read the latest analysis of this project from the server.</p>
          <button
            type="button"
            className="project-open"
            onClick={() => void refresh(project.id)}
          >
            Refresh
          </button>
        </div>
      )}
      {fetched && (
        <>
          <p
            className="sonar-target"
            title={
              fetched.target.kind === "pullRequest"
                ? fetched.target.title
                : undefined
            }
          >
            {targetLabel(fetched.target)}
            {fetched.revision && ` · ${fetched.revision.slice(0, 8)}`}
            {fetched.analysisDate && ` · ${ago(fetched.analysisDate)}`}
          </p>
          {gate && (
            <p
              className={`sonar-gate ${gate.status.toLowerCase()}`}
              title={gate.failing
                .map(
                  (c) =>
                    `${c.metric}: ${c.actual ?? "?"} (${c.comparator ?? ""} ${c.threshold ?? ""})`,
                )
                .join("\n")}
            >
              Quality Gate: {GATE[gate.status] ?? gate.status}
              {gate.failing.length > 0 &&
                ` · ${gate.failing.length} condition${gate.failing.length === 1 ? "" : "s"} failed`}
            </p>
          )}
          {state.summary && (
            <p className="sonar-summary">
              Since the last refresh: {state.summary.fixed} fixed,{" "}
              {state.summary.added} new
            </p>
          )}
          {fetched.revision && !state.revisionKnown && (
            <p className="sonar-warning" role="note">
              The analyzed commit {fetched.revision.slice(0, 10)} is not in this
              repository. Fetch it (git fetch) and refresh to place the issues.
            </p>
          )}
          {!fetched.revision && (
            <p className="sonar-warning" role="note">
              The server reported no commit for this analysis, so the issues
              cannot be matched to your files.
            </p>
          )}
          {fetched.truncated && (
            <p className="sonar-warning" role="note">
              Showing {fetched.issues.length} of {fetched.total} issues: the
              server returns at most 10 000.
            </p>
          )}
          <ul className="todo-list" aria-label="SonarQube issues">
            {TRACKS.map(({ id, title, hint }) => {
              const files = groups[id];
              const count = files.reduce((n, [, items]) => n + items.length, 0);
              if (!count && id !== "open") return null;
              const open = !closed.has(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    className="todo-group"
                    aria-expanded={open}
                    title={hint}
                    onClick={() => toggle(id)}
                  >
                    <span className="project-twisty" aria-hidden>
                      {open ? "▾" : "▸"}
                    </span>
                    <span className="todo-group-name">{title}</span>
                    <span className="todo-place">{count}</span>
                  </button>
                  {open && (
                    <ul>
                      {!count && (
                        <li className="sonar-empty">
                          {fetched.issues.length
                            ? "None at this severity."
                            : "The analysis has no open issues."}
                        </li>
                      )}
                      {files.map(([file, items]) => {
                        const fileId = `${id}:${file}`;
                        const shown = !closed.has(fileId);
                        return (
                          <li key={fileId}>
                            <button
                              type="button"
                              className="todo-group"
                              style={{ paddingLeft: 20 }}
                              aria-expanded={shown}
                              title={file}
                              onClick={() => toggle(fileId)}
                            >
                              <span className="project-twisty" aria-hidden>
                                {shown ? "▾" : "▸"}
                              </span>
                              <span className="todo-group-name">
                                {relative(root, file) ?? file}
                              </span>
                              <span className="todo-place">{items.length}</span>
                            </button>
                            {shown && (
                              <ul>
                                {items.map((item) => (
                                  <IssueRow
                                    key={item.issue.key}
                                    item={item}
                                    isNew={state.added.has(item.issue.key)}
                                  />
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
