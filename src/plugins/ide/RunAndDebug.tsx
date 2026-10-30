import { useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog";
import { CloseIcon, PlusIcon } from "../../components/Icons";
import { debugBackend, type ConfigInfo } from "../../services/debug";
import { allDocuments, dirty } from "../text-editor/documents";
import { choices, selectRunTarget, useCMake } from "./cmake";
import {
  addWatch,
  editWatch,
  enableAllBreakpoints,
  loadDebuggers,
  projectDebug,
  refusal,
  removeAllBreakpoints,
  removeBreakpoint,
  removeWatch,
  selectDebugger,
  selectFrame,
  selectThread,
  setBreakpoint,
  setBreakpointsActive,
  startDebugging,
  updateBreakpoint,
  useDebug,
  verification,
} from "./debug";
import {
  KIND_LABELS,
  kindOf,
  validHitCount,
  type BreakpointEntry,
} from "./debugModel";
import { VariableNode } from "./DebugValues";
import { Sections, useSectionState } from "./Sections";
import { documentFor, host, message, reveal } from "./editors";
import { baseName, pathKey, relative } from "./paths";
import type { Project } from "./projects";

const STOP_REASONS: Record<string, string> = {
  breakpoint: "Paused on breakpoint",
  step: "Paused",
  pause: "Paused",
  entry: "Paused on entry",
  exception: "Paused on exception",
  signal: "Paused on signal",
  "function breakpoint": "Paused on breakpoint",
  goto: "Paused",
};

/**
 * Run and Debug, as in VS Code: the launch target, Start, and the Variables, Watch, Call
 * Stack and Breakpoints sections. It stays when a session ends; only runtime data clears.
 */
export function RunAndDebug({ project }: { project: Project }) {
  const store = useDebug();
  const { info } = useCMake(project.id);
  const root = project.root!;
  const state = projectDebug(root)!;
  const sections = useSectionState(project, "debug");
  const [dialog, setDialog] = useState<"config" | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (info?.cmake) void loadDebuggers(root).catch(() => {});
  }, [root, info?.cmake]);
  const session = store.session;
  const mine = session?.project === project.id ? session : null;
  const debuggers = store.debuggers.get(pathKey(root));
  const target = choices(project.id).runTarget;
  const busy = !!session || store.phase !== "idle";
  const phase =
    store.phase === "checking"
      ? "Preparing…"
      : store.phase === "building"
        ? "Building…"
        : store.phase === "starting" || mine?.state === "starting"
          ? "Starting…"
          : mine?.state === "running"
            ? "Running"
            : mine?.state === "stopped"
              ? (STOP_REASONS[mine.stop?.reason ?? ""] ?? "Paused")
              : null;
  if (!info?.cmake)
    return (
      <div className="project-empty">
        <p>
          Debugging works with CMake projects: open a folder with a
          CMakeLists.txt (or set its source folder in Project Settings).
        </p>
      </div>
    );
  const problem =
    store.problem ??
    (debuggers && !debuggers.selected ? debuggers.error : null);
  const watchValues = mine?.state === "stopped" ? store.watchValues : null;
  return (
    <div className="debug-view">
      <div className="debug-launch">
        <button
          type="button"
          className="debug-start"
          disabled={busy}
          onClick={() =>
            void startDebugging(project.id).catch((e) => host().report(e))
          }
        >
          ▶ Start Debugging
        </button>
        <button
          type="button"
          className="debug-target"
          title="CMake: Select Run Target (the program Debug builds and starts)"
          disabled={busy}
          onClick={() =>
            void selectRunTarget(project.id).catch((e) => host().report(e))
          }
        >
          {target ?? "No target"} ▾
        </button>
        <button
          type="button"
          aria-label="Debug configuration"
          title="Arguments, working folder and environment (.tessera/debug.json)"
          onClick={() => setDialog("config")}
        >
          ⚙
        </button>
      </div>
      <div className="debug-meta">
        <span className="muted">
          {phase ??
            (debuggers?.selected
              ? `Debugger: ${debuggers.adapters.find((a) => a.adapter === debuggers.selected)?.label}${debuggers.choice === "auto" ? " (automatic)" : ""}`
              : "")}
        </span>
        <button
          type="button"
          className="debug-link"
          disabled={!!session}
          onClick={() =>
            void selectDebugger(project.id).catch((e) => host().report(e))
          }
        >
          Select Debugger…
        </button>
      </div>
      {problem && !session && (
        <p className="debug-problem" role="alert">
          {problem}
        </p>
      )}
      {session && !mine && (
        <p className="debug-problem">
          Another project is being debugged; stop it to debug this one.
        </p>
      )}
      <Sections
        project={project}
        view="debug"
        sections={[
          {
            id: "variables",
            title: "Variables",
            size: 3,
            body: (
              <div className="debug-section" role="tree" aria-label="Variables">
                {mine?.state === "stopped" ? (
                  mine.scopes.map((scope) => (
                    <VariableNode
                      key={`${scope.name}\0${scope.variablesReference}`}
                      variable={{
                        name: scope.name,
                        value: "",
                        variablesReference: scope.variablesReference,
                      }}
                      parent={0}
                      path={scope.name}
                      depth={0}
                    />
                  ))
                ) : (
                  <p className="debug-hint">
                    Variables appear while the program is paused.
                  </p>
                )}
              </div>
            ),
          },
          {
            id: "watch",
            title: "Watch",
            size: 2,
            actions: (
              <button
                type="button"
                aria-label="Add Expression"
                title="Add Expression"
                onClick={() => {
                  sections.open("watch");
                  setAdding(true);
                }}
              >
                <PlusIcon />
              </button>
            ),
            body: (
              <div className="debug-section" role="tree" aria-label="Watch">
                {state.watches.map((expression, index) => (
                  <WatchRow
                    key={`${index}\0${expression}`}
                    expression={expression}
                    value={watchValues?.get(expression) ?? null}
                    onEdit={(text) => editWatch(root, index, text)}
                    onRemove={() => removeWatch(root, index)}
                  />
                ))}
                {adding && (
                  <ExpressionInput
                    label="Expression to watch"
                    onDone={(text) => {
                      setAdding(false);
                      if (text) addWatch(root, text);
                    }}
                  />
                )}
                {!state.watches.length && !adding && (
                  <p className="debug-hint">No watch expressions.</p>
                )}
              </div>
            ),
          },
          {
            id: "stack",
            title: "Call Stack",
            size: 2,
            body: (
              <div className="debug-section" aria-label="Call Stack">
                {mine && mine.threads.length ? (
                  <ul className="debug-stack">
                    {mine.threads.map((thread) => {
                      const selected = thread.id === mine.thread;
                      return (
                        <li key={thread.id}>
                          <button
                            type="button"
                            className="debug-row debug-thread"
                            aria-current={selected}
                            onClick={() =>
                              void selectThread(thread.id).catch((e) =>
                                host().report(e),
                              )
                            }
                          >
                            <span className="debug-name">{thread.name}</span>
                            <span className="muted">
                              {mine.state === "stopped"
                                ? thread.id === mine.stop?.threadId
                                  ? (STOP_REASONS[mine.stop.reason] ?? "Paused")
                                  : "Paused"
                                : "Running"}
                            </span>
                          </button>
                          {selected && mine.state === "stopped" && (
                            <ul>
                              {mine.frames.map((frame) => (
                                <li key={frame.id}>
                                  <button
                                    type="button"
                                    className={`debug-row debug-frame${frame.path ? "" : " no-source"}`}
                                    aria-current={frame.id === mine.frame}
                                    onClick={() =>
                                      void selectFrame(frame.id).catch((e) =>
                                        host().report(e),
                                      )
                                    }
                                  >
                                    <span className="debug-name">
                                      {frame.name}
                                    </span>
                                    <span className="muted">
                                      {frame.path
                                        ? `${baseName(frame.path)}:${frame.line}`
                                        : "no source"}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="debug-hint">
                    {mine ? "Running…" : "Not debugging."}
                  </p>
                )}
                {mine?.stop?.text && (
                  <p className="debug-problem">{mine.stop.text}</p>
                )}
              </div>
            ),
          },
          {
            id: "breakpoints",
            title: "Breakpoints",
            size: 2,
            actions: (
              <>
                <button
                  type="button"
                  aria-label={
                    state.active
                      ? "Deactivate Breakpoints"
                      : "Activate Breakpoints"
                  }
                  title={
                    state.active
                      ? "Deactivate Breakpoints"
                      : "Activate Breakpoints"
                  }
                  aria-pressed={!state.active}
                  onClick={() => setBreakpointsActive(root, !state.active)}
                >
                  ⊘
                </button>
                <button
                  type="button"
                  aria-label="Remove All Breakpoints"
                  title="Remove All Breakpoints"
                  disabled={!state.breakpoints.length}
                  onClick={() => removeAllBreakpoints(root)}
                >
                  <CloseIcon />
                </button>
              </>
            ),
            body: (
              <div className="debug-section" aria-label="Breakpoints">
                {state.breakpoints.length > 0 && (
                  <label className="debug-row debug-all">
                    <input
                      type="checkbox"
                      checked={state.breakpoints.every((b) => b.enabled)}
                      onChange={(e) =>
                        enableAllBreakpoints(root, e.target.checked)
                      }
                    />
                    All breakpoints
                    {!state.active && (
                      <span className="muted"> (deactivated)</span>
                    )}
                  </label>
                )}
                {state.breakpoints.map((bp) => (
                  <BreakpointRow key={bp.uid} breakpoint={bp} root={root} />
                ))}
                {!state.breakpoints.length && (
                  <p className="debug-hint">
                    Click left of a line number to add a breakpoint; right-click
                    for conditions and logpoints.
                  </p>
                )}
              </div>
            ),
          },
        ]}
      />
      {dialog === "config" && (
        <ConfigDialog project={project} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function WatchRow({
  expression,
  value,
  onEdit,
  onRemove,
}: {
  expression: string;
  value: {
    value: string;
    variablesReference: number;
    error: boolean;
    type?: string;
  } | null;
  onEdit: (text: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <ExpressionInput
        label="Edit expression"
        initial={expression}
        onDone={(text) => {
          setEditing(false);
          if (text !== null) onEdit(text);
        }}
      />
    );
  return (
    <div className="debug-watch" onDoubleClick={() => setEditing(true)}>
      {value && !value.error ? (
        <VariableNode
          variable={{
            name: expression,
            value: value.value,
            type: value.type,
            variablesReference: value.variablesReference,
          }}
          parent={0}
          path={`watch:${expression}`}
          depth={0}
        />
      ) : (
        <div className="debug-row" style={{ paddingLeft: 18 }}>
          <span className="debug-name">{expression}: </span>
          <span className={value?.error ? "debug-error" : "muted"}>
            {value?.value ?? "not available"}
          </span>
        </div>
      )}
      <button
        type="button"
        className="debug-row-action"
        aria-label={`Remove ${expression}`}
        title="Remove Expression"
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
function ExpressionInput({
  label,
  initial = "",
  onDone,
}: {
  label: string;
  initial?: string;
  /** null when cancelled. */
  onDone: (text: string | null) => void;
}) {
  return (
    <input
      className="debug-edit debug-expression"
      aria-label={label}
      defaultValue={initial}
      autoFocus
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(event.currentTarget.value.trim());
        if (event.key === "Escape") onDone(null);
      }}
      onBlur={(event) => onDone(event.currentTarget.value.trim() || null)}
    />
  );
}

function BreakpointRow({
  breakpoint,
  root,
}: {
  breakpoint: BreakpointEntry;
  root: string;
}) {
  const [editing, setEditing] = useState(false);
  const kind = kindOf(breakpoint);
  const answer = verification(breakpoint.uid);
  const refused = refusal(breakpoint.uid);
  const detail =
    breakpoint.logMessage ||
    [
      breakpoint.condition && `when ${breakpoint.condition}`,
      breakpoint.hitCondition && `from hit ${breakpoint.hitCondition}`,
    ]
      .filter(Boolean)
      .join(", ");
  const problem =
    refused ??
    (answer && !answer.verified
      ? `Not bound${answer.message ? `: ${answer.message}` : ""}`
      : null);
  return (
    <div className="debug-breakpoint">
      <input
        type="checkbox"
        aria-label={`Enable ${baseName(breakpoint.path)}:${breakpoint.line}`}
        checked={breakpoint.enabled}
        onChange={(e) =>
          updateBreakpoint(breakpoint.uid, { enabled: e.target.checked })
        }
      />
      <span
        className={`cm-breakpoint ${kind}${breakpoint.enabled ? "" : " disabled"}${problem ? " unverified" : ""}`}
        aria-hidden
      />
      <button
        type="button"
        className="debug-row debug-breakpoint-place"
        title={`${KIND_LABELS[kind]} · ${relative(root, breakpoint.path)}:${breakpoint.line}`}
        onClick={() =>
          void reveal(breakpoint.path, {
            line: breakpoint.line,
            column: 0,
          }).catch((e) => host().report(e))
        }
        onDoubleClick={() => setEditing(true)}
      >
        <span className="debug-name">{baseName(breakpoint.path)}</span>
        <span className="muted">{breakpoint.line}</span>
        {detail && <span className="debug-detail">{detail}</span>}
      </button>
      {problem && (
        <span className="debug-warning" title={problem} aria-label={problem}>
          ⚠
        </span>
      )}
      <button
        type="button"
        className="debug-row-action"
        aria-label="Edit Breakpoint"
        title="Edit Breakpoint"
        onClick={() => setEditing(true)}
      >
        ✎
      </button>
      <button
        type="button"
        className="debug-row-action"
        aria-label="Remove Breakpoint"
        title="Remove Breakpoint"
        onClick={() => removeBreakpoint(breakpoint.uid)}
      >
        <CloseIcon />
      </button>
      {editing && (
        <BreakpointDialog
          path={breakpoint.path}
          line={breakpoint.line}
          breakpoint={breakpoint}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

/**
 * A breakpoint's condition, hit count and log message (a message makes it a logpoint that
 * does not pause). Saving creates the breakpoint when the line has none.
 */
export function BreakpointDialog({
  path,
  line,
  breakpoint,
  focus = "condition",
  onClose,
}: {
  path: string;
  line: number;
  breakpoint: BreakpointEntry | null;
  focus?: "condition" | "hitCondition" | "logMessage";
  onClose: () => void;
}) {
  const [condition, setCondition] = useState(breakpoint?.condition ?? "");
  const [hits, setHits] = useState(breakpoint?.hitCondition ?? "");
  const [log, setLog] = useState(breakpoint?.logMessage ?? "");
  const badHits = hits.trim() !== "" && !validHitCount(hits);
  return (
    <Dialog
      title={`${breakpoint ? "Edit" : "Add"} breakpoint · ${baseName(path)}:${line}`}
      onCancel={onClose}
    >
      <form
        className="project-settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (badHits) return;
          setBreakpoint(path, line, {
            condition: condition.trim(),
            hitCondition: hits.trim(),
            logMessage: log.trim(),
            enabled: true,
          });
          onClose();
        }}
      >
        <label className="project-exclude">
          Condition (stop only when this expression is true)
          <input
            aria-label="Condition"
            placeholder="e.g. i == 10"
            value={condition}
            autoFocus={focus === "condition"}
            onChange={(e) => setCondition(e.target.value)}
          />
        </label>
        <label className="project-exclude">
          Hit count (stop from this hit on)
          <input
            aria-label="Hit count"
            inputMode="numeric"
            placeholder="e.g. 5"
            value={hits}
            autoFocus={focus === "hitCondition"}
            onChange={(e) => setHits(e.target.value)}
          />
        </label>
        <label className="project-exclude">
          Log message (a logpoint: print to the Debug Console without pausing;{" "}
          {"{expression}"} is replaced by its value)
          <input
            aria-label="Log message"
            placeholder="e.g. total is {total}"
            value={log}
            autoFocus={focus === "logMessage"}
            onChange={(e) => setLog(e.target.value)}
          />
        </label>
        {badHits && (
          <p className="settings-warning" role="alert">
            The hit count must be a positive whole number.
          </p>
        )}
        <div className="dialog-actions">
          <button disabled={badHits}>Save</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
/**
 * The visual editor of `.tessera/debug.json`: a target's arguments, working folder and
 * environment. Empty fields keep Run's settings (Project Settings).
 */
function ConfigDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const root = project.root!;
  const { info } = useCMake(project.id);
  const targets = (info?.targets ?? [])
    .filter((t) => t.kind === "EXECUTABLE")
    .map((t) => t.name);
  const [target, setTarget] = useState(
    choices(project.id).runTarget ?? targets[0] ?? "",
  );
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [env, setEnv] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    void debugBackend
      .config(root)
      .then(setConfig)
      .catch((e) => setError(message(e)));
  }, [root]);
  useEffect(() => {
    const entry = config?.file?.targets[target];
    setArgs((entry?.args ?? []).join("\n"));
    setCwd(entry?.cwd ?? "");
    setEnv(
      Object.entries(entry?.env ?? {})
        .map(([k, v]) => `${k}=${v}`)
        .join("\n"),
    );
  }, [config, target]);
  const open = async () => {
    if (!config) return;
    const id = await documentFor(config.path);
    host().showCode(id);
    onClose();
  };
  async function save() {
    if (!config || !target) return;
    // An editor with unsaved changes to the file wins: never write under it.
    const editing = allDocuments().find(
      (d) => d.path && pathKey(d.path) === pathKey(config.path) && dirty(d),
    );
    if (editing)
      throw new Error(
        "debug.json has unsaved changes in an editor; save or close it first",
      );
    const environment: Record<string, string> = {};
    for (const line of lines(env)) {
      const at = line.indexOf("=");
      if (at <= 0) throw new Error(`Environment lines are NAME=value: ${line}`);
      environment[line.slice(0, at).trim()] = line.slice(at + 1);
    }
    const next = await debugBackend.setConfig(root, target, {
      ...(lines(args).length && {
        args: args.split("\n").filter((a) => a.trim()),
      }),
      ...(cwd.trim() && { cwd: cwd.trim() }),
      ...(Object.keys(environment).length && { env: environment }),
    });
    setConfig(next);
    onClose();
  }
  return (
    <Dialog title="Debug configuration" onCancel={onClose}>
      <form
        className="project-settings"
        onSubmit={(event) => {
          event.preventDefault();
          void save().catch((e) => setError(message(e)));
        }}
      >
        <p className="muted">
          Saved in .tessera/debug.json in the project, which can be shared
          through Git: never put passwords or tokens here. Empty fields use the
          Run settings. The program itself comes from CMake.
        </p>
        <label className="project-exclude">
          Target
          <select
            aria-label="Target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            {!targets.includes(target) && target && (
              <option value={target}>{target}</option>
            )}
            {targets.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {!target && (
          <p className="muted">Configure the project to list its targets.</p>
        )}
        <label className="project-exclude">
          Program arguments (one per line)
          <textarea
            aria-label="Program arguments"
            rows={3}
            value={args}
            onChange={(e) => setArgs(e.target.value)}
          />
        </label>
        <label className="project-exclude">
          Working folder (relative to the project; ${"{workspaceFolder}"}, $
          {"{sourceDir}"}, ${"{buildDir}"} and ${"{env:NAME}"} work)
          <input
            aria-label="Working folder"
            placeholder="The program's folder"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
          />
        </label>
        <label className="project-exclude">
          Environment variables (NAME=value, one per line)
          <textarea
            aria-label="Environment variables"
            rows={3}
            value={env}
            onChange={(e) => setEnv(e.target.value)}
          />
        </label>
        {(config?.error || error) && (
          <p className="settings-warning" role="alert">
            {config?.error ?? error}
          </p>
        )}
        <div className="dialog-actions">
          {config?.exists && (
            <button
              type="button"
              onClick={() => void open().catch((e) => setError(message(e)))}
            >
              Open debug.json
            </button>
          )}
          <button disabled={!config || !!config.error || !target}>Save</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
