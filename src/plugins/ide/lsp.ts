import { useSyncExternalStore } from "react";
import { ChangeSet, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  hoverTooltips,
  serverCompletion,
  serverDiagnostics,
  signatureHelp,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import {
  allDocuments,
  getDocument,
  hasDocument,
  updateDocument,
} from "../text-editor/documents";
import { analysisBackend } from "../../services/analysis";
import { ideBackend, type ServerInfo } from "../../services/ide";
import {
  clearDiagnostics,
  diagnosticsOf,
  host,
  message,
  reveal,
  setDiagnostics,
  setResults,
  viewOf,
  type Diagnostic,
  type ResultItem,
} from "./editors";
import {
  applyEdits,
  fileEdits,
  offsetAt,
  resolveEdits,
  type LspPosition,
  type TextEdit,
  type WorkspaceEdit,
} from "./model";
import { projectFor, setView, settingsFor } from "./projects";
import { enabled, onFeatures } from "./features";
import { semanticCapabilities } from "./semanticTokens";
import {
  clearInactiveRegions,
  inactiveCapabilities,
  setInactiveRegions,
} from "./inactiveRegions";
import { paint } from "./lint";
import {
  baseName,
  fromUri,
  pathKey,
  relative,
  serverFor,
  toUri,
  within,
} from "./paths";

export type ServerStatus =
  "starting" | "ready" | "missing" | "failed" | "stopped";
interface Server {
  key: string;
  id: string;
  root: string;
  server: string;
  status: ServerStatus;
  detail: string;
  progress: string;
  client: LSPClient;
  workspace: DocumentWorkspace;
}
interface Store {
  servers: Map<string, Server>;
  info: ServerInfo[] | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideLsp ?? {
  servers: new Map(),
  info: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideLsp = store;
function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
export function useServers() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
function setStatus(server: Server, change: Partial<Server>) {
  Object.assign(server, change);
  emit();
}

/**
 * A file split into two views syncs through the focused one, whose changes the server gets;
 * the other follows the document's text.
 */
export function followView(view: EditorView, path: string | null) {
  const plugin = LSPPlugin.get(view);
  const running = serverForFile(path);
  if (!plugin || !running || !path) return;
  (running.server.client.workspace as DocumentWorkspace).openFile(
    toUri(path),
    running.language,
    view,
  );
  plugin.clear();
}
/** The document behind each editor view, so the workspace can follow tab switches. */
const documentOf = new WeakMap<EditorView, string>();
export function bindView(view: EditorView, id: string) {
  documentOf.set(view, id);
}

class DocumentFile implements WorkspaceFile {
  view: EditorView | null = null;
  constructor(
    readonly uri: string,
    readonly languageId: string,
    public version: number,
    public doc: Text,
    readonly documentId: string,
  ) {}
  getView() {
    return this.view;
  }
}
/**
 * Files stay open on the server while their document is open, not just while a view
 * shows them: Mozaik unmounts hidden tabs, and reopening the file on every tab switch
 * would make the server reparse it and drop its diagnostics.
 */
class DocumentWorkspace extends Workspace {
  files: DocumentFile[] = [];
  private versions = new Map<string, number>();
  private next(uri: string) {
    const version = (this.versions.get(uri) ?? -1) + 1;
    this.versions.set(uri, version);
    return version;
  }
  syncFiles(): ReturnType<Workspace["syncFiles"]> {
    const result: { changes: ChangeSet; file: WorkspaceFile; prevDoc: Text }[] =
      [];
    for (const file of this.files) {
      const plugin = file.view && LSPPlugin.get(file.view);
      if (plugin) {
        const changes = plugin.unsyncedChanges;
        if (changes.empty) continue;
        result.push({ changes, file, prevDoc: file.doc });
        file.doc = file.view!.state.doc;
        file.version = this.next(file.uri);
        plugin.clear();
      } else if (hasDocument(file.documentId)) {
        const text = getDocument(file.documentId).text;
        if (text === file.doc.toString()) continue;
        const prevDoc = file.doc;
        file.doc = Text.of(text.split("\n"));
        file.version = this.next(file.uri);
        result.push({
          changes: ChangeSet.of(
            [{ from: 0, to: prevDoc.length, insert: text }],
            prevDoc.length,
          ),
          file,
          prevDoc,
        });
      }
    }
    return result;
  }
  openFile(uri: string, languageId: string, view: EditorView) {
    const existing = this.getFile(uri) as DocumentFile | null;
    if (existing) {
      existing.view = view;
      if (existing.doc.toString() !== view.state.doc.toString()) {
        existing.doc = view.state.doc;
        existing.version = this.next(uri);
        this.client.notification("textDocument/didChange", {
          textDocument: { uri, version: existing.version },
          contentChanges: [{ text: view.state.doc.toString() }],
        });
      }
      // Not inside the view update that is constructing this plugin.
      queueMicrotask(() => showDiagnostics(view, fromUri(uri)));
      return;
    }
    const documentId = documentOf.get(view);
    if (!documentId) return;
    const file = new DocumentFile(
      uri,
      languageId,
      this.next(uri),
      view.state.doc,
      documentId,
    );
    this.files.push(file);
    this.client.didOpen(file);
  }
  closeFile(uri: string, view: EditorView) {
    const file = this.getFile(uri) as DocumentFile | null;
    if (file?.view === view) file.view = null;
  }
  /** The document was closed: the server forgets the file. */
  forget(uri: string) {
    const file = this.getFile(uri);
    if (!file) return;
    this.files = this.files.filter((f) => f !== file);
    if (this.client.connected) this.client.didClose(uri);
  }
  async displayFile(uri: string) {
    return reveal(fromUri(uri));
  }
}

/** Shows stored diagnostics (with other providers' marks) in a view. */
const showDiagnostics = paint;

// Plain-text rendering of server Markdown (hover, completion docs) through a fixed set of
// elements: no attributes, links, images or raw HTML survive.
const ALLOWED = new Set([
  "P",
  "PRE",
  "CODE",
  "EM",
  "STRONG",
  "UL",
  "OL",
  "LI",
  "HR",
  "BR",
  "H1",
  "H2",
  "H3",
  "H4",
  "BLOCKQUOTE",
  "SPAN",
  "DIV",
]);
/** A hover's code block language (`cpp`, `c`), if an editor has already loaded it. */
function codeLanguage(name: string) {
  return (
    LanguageDescription.matchLanguageName(languages, name)?.support?.language ??
    null
  );
}

export function sanitize(html: string) {
  const source = new DOMParser().parseFromString(html, "text/html").body;
  const output = document.createElement("div");
  const copy = (from: Node, to: Node) => {
    for (const node of from.childNodes) {
      if (node.nodeType === Node.TEXT_NODE)
        to.appendChild(document.createTextNode(node.textContent ?? ""));
      else if (node instanceof Element) {
        if (ALLOWED.has(node.tagName)) {
          const clean = document.createElement(node.tagName.toLowerCase());
          // Keep only highlighting classes from the client's own renderer (CodeMirror
          // names them like `ͼ1a`).
          const classes = node.getAttribute("class");
          if (classes && /^[\p{L}\p{N}_\s-]+$/u.test(classes))
            clean.setAttribute("class", classes);
          to.appendChild(clean);
          copy(node, clean);
        } else if (
          !["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName)
        )
          copy(node, to);
      }
    }
  };
  copy(source, output);
  return output.innerHTML;
}

const capabilities = {
  textDocument: {
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            "",
            "quickfix",
            "refactor",
            "refactor.extract",
            "refactor.inline",
            "refactor.rewrite",
            "source",
          ],
        },
      },
      isPreferredSupport: true,
    },
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    rename: { prepareSupport: true },
    rangeFormatting: {},
    publishDiagnostics: { relatedInformation: false },
    semanticTokens: semanticCapabilities,
    // clangd's extension: code the preprocessor leaves out.
    inactiveRegionsCapabilities: inactiveCapabilities,
  },
  workspace: { applyEdit: true, workspaceEdit: { documentChanges: true } },
  window: { workDoneProgress: true },
};

/** Requests a server makes of the client. Everything else is answered "not supported". */
async function serverRequest(server: Server, method: string, params: any) {
  if (method === "workspace/applyEdit") {
    try {
      await applyWorkspaceEdit(params.edit, params.label ?? "Apply change");
      return { applied: true };
    } catch (e) {
      host().report(e);
      return { applied: false, failureReason: message(e) };
    }
  }
  if (method === "workspace/configuration")
    return (params.items ?? []).map(() => null);
  if (
    method === "window/workDoneProgress/create" ||
    method === "client/registerCapability" ||
    method === "client/unregisterCapability" ||
    method === "window/showMessageRequest"
  )
    return null;
  void server;
  throw { code: -32601, message: `${method} is not supported` };
}

function start(root: string, kind: string): Server {
  const key = `${kind}\0${pathKey(root)}`;
  // A failed or missing server stays so until `restart`: never restart in a loop.
  const existing = store.servers.get(key);
  if (existing) return existing;
  const handlers = new Set<(value: string) => void>();
  const id = crypto.randomUUID();
  const transport: Transport = {
    send(value) {
      void ideBackend.lspSend(id, value).catch(() => {});
    },
    subscribe: (handler) => void handlers.add(handler),
    unsubscribe: (handler) => void handlers.delete(handler),
  };
  // Files without a compilation database: the warnings of Settings → IDE → Code Analysis.
  const startOptions: { fallbackFlags: string[] } = { fallbackFlags: [] };
  const client = new LSPClient({
    rootUri: toUri(root),
    timeout: 15000,
    initializationOptions: startOptions,
    sanitizeHTML: sanitize,
    highlightLanguage: codeLanguage,
    workspace: (client) => new DocumentWorkspace(client),
    notificationHandlers: {
      "textDocument/publishDiagnostics": (_client, params) => {
        const path = fromUri(params.uri);
        setDiagnostics(path, params.diagnostics as Diagnostic[]);
        const doc = allDocuments().find(
          (d) => d.path && pathKey(d.path) === pathKey(path),
        );
        const view = doc && viewOf(doc.id);
        if (view && LSPPlugin.get(view)) showDiagnostics(view, path);
        return true;
      },
      "textDocument/inactiveRegions": (_client, params) => {
        const uri = params?.textDocument?.uri;
        if (typeof uri === "string" && Array.isArray(params.regions))
          setInactiveRegions(fromUri(uri), params.regions);
        return true;
      },
      "$/progress": (_client, params) => {
        const value = params.value ?? {};
        setStatus(server, {
          progress:
            value.kind === "end"
              ? ""
              : [
                  value.title,
                  value.message,
                  value.percentage != null ? `${value.percentage}%` : "",
                ]
                  .filter(Boolean)
                  .join(" "),
        });
        return true;
      },
      "window/logMessage": () => true,
    },
    extensions: [
      serverCompletion(),
      hoverTooltips(),
      signatureHelp({ keymap: false }),
      serverDiagnostics(),
      { clientCapabilities: capabilities },
    ],
  });
  const server: Server = {
    key,
    id,
    root,
    server: kind,
    status: "starting",
    detail: "",
    progress: "",
    client,
    workspace: client.workspace as DocumentWorkspace,
  };
  store.servers.set(key, server);
  emit();
  void (async () => {
    try {
      const info = await serverInfo();
      if (!info.find((s) => s.id === kind)?.path) {
        setStatus(server, {
          status: "missing",
          detail: `${kind} was not found. Install it, or choose the program in IDE settings. Editing works without it.`,
        });
        return;
      }
      const program = await ideBackend.lspStart(id, kind, root, (event) => {
        if (event.kind === "exit") {
          if (store.servers.get(key) !== server) return;
          client.disconnect();
          clearDiagnostics((path) => within(root, path));
          clearInactiveRegions((path) => within(root, path));
          const stopped = server.status === "stopped";
          setStatus(server, {
            status: stopped ? "stopped" : "failed",
            progress: "",
            detail: stopped
              ? ""
              : `${kind} exited${event.code != null ? ` with code ${event.code}` : ""}.${event.log ? `\n${event.log}` : ""}`,
          });
          return;
        }
        let value: any;
        try {
          value = JSON.parse(event.data);
        } catch {
          return;
        }
        if ("id" in value && "method" in value) {
          void serverRequest(server, value.method, value.params).then(
            (result) =>
              transport.send(
                JSON.stringify({ jsonrpc: "2.0", id: value.id, result }),
              ),
            (error) =>
              transport.send(
                JSON.stringify({ jsonrpc: "2.0", id: value.id, error }),
              ),
          );
          return;
        }
        handlers.forEach((handler) => handler(event.data));
      });
      setStatus(server, { detail: program });
      const settings = await analysisBackend.info().catch(() => null);
      startOptions.fallbackFlags = (settings?.settings.warningFlags ?? "")
        .split(/\s+/)
        .filter(Boolean);
      client.connect(transport);
      await client.initializing;
      if (store.servers.get(key) === server && server.status === "starting")
        setStatus(server, { status: "ready" });
    } catch (e) {
      setStatus(server, { status: "failed", detail: message(e) });
    }
  })();
  return server;
}

export async function serverInfo(refresh = false) {
  if (!store.info || refresh) {
    store.info = await ideBackend.servers();
    emit();
  }
  return store.info;
}
/** The running server for a file in an open project, starting it on first use. */
export function serverForFile(path: string | null) {
  // The language server turned off (Settings → IDE → Features): none starts.
  if (!path || !enabled("languageServer")) return null;
  const kind = serverFor(path);
  const project = projectFor(path);
  if (!kind || !project?.root) return null;
  return { server: start(project.root, kind.server), language: kind.language };
}
export function serverOf(path: string | null) {
  const kind = path && serverFor(path);
  const project = path ? projectFor(path) : null;
  if (!kind || !project?.root) return null;
  return store.servers.get(`${kind.server}\0${pathKey(project.root)}`) ?? null;
}
export function stopServers(root: string) {
  for (const server of store.servers.values()) {
    if (pathKey(server.root) !== pathKey(root) || server.status === "stopped")
      continue;
    const wasRunning =
      server.status === "ready" || server.status === "starting";
    server.status = "stopped";
    if (wasRunning && server.client.connected) {
      // Ask politely first; Rust closes its input and terminates it if it lingers.
      void server.client
        .request("shutdown", null)
        .catch(() => {})
        .finally(() => {
          server.client.notification("exit", null);
          void ideBackend.lspStop(server.id).catch(() => {});
        });
    } else void ideBackend.lspStop(server.id).catch(() => {});
    clearDiagnostics((path) => within(root, path));
    clearInactiveRegions((path) => within(root, path));
  }
  emit();
}
export function restart(root: string) {
  stopServers(root);
  for (const server of [...store.servers.values()])
    if (pathKey(server.root) === pathKey(root))
      store.servers.delete(server.key);
  store.info = null;
  emit();
}
// Turned off, the running servers stop; turned on, editors connect again (they follow emit).
onFeatures(() => {
  if (!enabled("languageServer"))
    for (const root of new Set([...store.servers.values()].map((s) => s.root)))
      restart(root);
  emit();
});
/** The document closed: its file leaves every server. */
export function forgetDocument(path: string | null) {
  if (!path) return;
  for (const server of store.servers.values())
    server.workspace.forget(toUri(path));
  setDiagnostics(path, []);
}

function pluginOf(view: EditorView) {
  const plugin = LSPPlugin.get(view);
  if (!plugin)
    throw new Error(
      "No language server is running for this file. Open it inside a C/C++ project with clangd installed.",
    );
  return plugin;
}
type Location = {
  uri: string;
  range: { start: LspPosition; end: LspPosition };
};
type LocationLink = {
  targetUri: string;
  targetSelectionRange: Location["range"];
};
function locations(response: Location | Location[] | LocationLink[] | null) {
  const list = !response ? [] : Array.isArray(response) ? response : [response];
  return list.map((item) =>
    "targetUri" in item
      ? { uri: item.targetUri, range: item.targetSelectionRange }
      : item,
  );
}
async function textOf(path: string) {
  const doc = allDocuments().find(
    (d) => d.path && pathKey(d.path) === pathKey(path),
  );
  return doc ? doc.text : (await ideBackend.read(path)).text;
}
async function resultItems(list: Location[]) {
  const texts = new Map<string, string[] | null>();
  const items: ResultItem[] = [];
  for (const location of list) {
    const path = fromUri(location.uri);
    if (!texts.has(path))
      texts.set(
        path,
        await textOf(path)
          .then((t) => t.split("\n"))
          .catch(() => null),
      );
    const line = texts.get(path)?.[location.range.start.line] ?? "";
    const start = location.range.start.character;
    const skip = Math.max(0, start - 60);
    items.push({
      path,
      line: location.range.start.line + 1,
      column: start,
      length:
        location.range.end.line === location.range.start.line
          ? location.range.end.character - start
          : 0,
      preview: line.slice(skip, skip + 240),
      offset: start - skip,
    });
  }
  return items;
}
/** Lists navigation results in the sidebar of the project the request came from. */
async function showResults(view: EditorView, title: string, found: Location[]) {
  setResults({ title, items: await resultItems(found) });
  const plugin = LSPPlugin.get(view);
  const project = plugin && projectFor(fromUri(plugin.uri));
  if (project) setView(project.id, "results");
}
const wordAt = (view: EditorView) => {
  const range = view.state.wordAt(view.state.selection.main.head);
  return range ? view.state.sliceDoc(range.from, range.to) : "symbol";
};

export type Navigation =
  "definition" | "declaration" | "implementation" | "typeDefinition";
const labels: Record<Navigation, string> = {
  definition: "Definitions",
  declaration: "Declarations",
  implementation: "Implementations",
  typeDefinition: "Type definitions",
};
/** Jumps to the only result, or lists several in the project sidebar. */
export async function goTo(view: EditorView, kind: Navigation) {
  const plugin = pluginOf(view);
  plugin.client.sync();
  const response = await plugin.client.request<unknown, any>(
    `textDocument/${kind}`,
    {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(view.state.selection.main.head),
    },
  );
  const found = locations(response);
  if (!found.length) throw new Error(`No ${labels[kind].toLowerCase()} found.`);
  if (found.length === 1) {
    await reveal(fromUri(found[0].uri), found[0].range.start);
    return;
  }
  await showResults(view, `${labels[kind]} of ${wordAt(view)}`, found);
}
export async function findReferences(view: EditorView) {
  const plugin = pluginOf(view);
  plugin.client.sync();
  const response = await plugin.client.request<unknown, Location[] | null>(
    "textDocument/references",
    {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(view.state.selection.main.head),
      context: { includeDeclaration: true },
    },
  );
  const found = locations(response);
  if (!found.length) throw new Error("No references found.");
  await showResults(view, `References to ${wordAt(view)}`, found);
}
/** clangd's extension: from a source file to its header, or back. */
export async function switchSourceHeader(view: EditorView) {
  const plugin = pluginOf(view);
  const target = await plugin.client.request<unknown, string | null>(
    "textDocument/switchSourceHeader",
    { uri: plugin.uri },
  );
  if (!target) throw new Error("No matching header or source file found.");
  await reveal(fromUri(target));
}

/**
 * Applies a server edit. Open documents change in their editor (undoable); files that are
 * not open are changed on disk only after confirmation, each with a revision check and an
 * atomic save.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit, label: string) {
  const perFile = fileEdits(edit);
  const open: { id: string; edits: TextEdit[] }[] = [];
  const closed: { path: string; edits: TextEdit[] }[] = [];
  for (const [uri, edits] of perFile) {
    const path = fromUri(uri);
    const doc = allDocuments().find(
      (d) => d.path && pathKey(d.path) === pathKey(path),
    );
    if (doc) open.push({ id: doc.id, edits });
    else closed.push({ path, edits });
  }
  // Validate every file first, so a bad edit changes nothing.
  const prepared = await Promise.all(
    closed.map(async ({ path, edits }) => {
      const file = await ideBackend.read(path);
      return { file, text: applyEdits(file.text, edits) };
    }),
  );
  for (const { id, edits } of open) resolveEdits(getDocument(id).text, edits);
  if (prepared.length) {
    const names = prepared.map((p) => baseName(p.file.path));
    const choice = await host().ask(
      label,
      `This changes ${prepared.length} file${prepared.length === 1 ? "" : "s"} that ${prepared.length === 1 ? "is" : "are"} not open (${names.slice(0, 8).join(", ")}${names.length > 8 ? ", …" : ""}). ${prepared.length === 1 ? "It is" : "They are"} saved directly. Open files change in their editors and stay unsaved.`,
      ["Apply", "Cancel"],
    );
    if (choice !== "Apply") return false;
  }
  for (const { id, edits } of open) {
    const view = viewOf(id);
    if (view)
      view.dispatch({
        changes: resolveEdits(view.state.doc.toString(), edits),
        userEvent: "input.lsp",
      });
    else updateDocument(id, { text: applyEdits(getDocument(id).text, edits) });
  }
  const failures: string[] = [];
  for (const { file, text } of prepared) {
    try {
      await ideBackend.save({
        path: file.path,
        text,
        revision: file.revision,
        bom: file.bom,
        ending: file.ending,
        name: file.name,
      });
    } catch (e) {
      failures.push(`${file.name}: ${message(e)}`);
    }
  }
  if (failures.length)
    throw new Error(`Some files were not changed:\n${failures.join("\n")}`);
  return true;
}

export async function prepareRename(view: EditorView) {
  const plugin = pluginOf(view);
  plugin.client.sync();
  const position = plugin.toPosition(view.state.selection.main.head);
  const prepared = await plugin.client
    .request<unknown, any>("textDocument/prepareRename", {
      textDocument: { uri: plugin.uri },
      position,
    })
    .catch(() => undefined);
  if (prepared === null) throw new Error("This symbol cannot be renamed.");
  const range = prepared?.range ?? (prepared?.start ? prepared : null);
  const text = view.state.doc.toString();
  const name =
    prepared?.placeholder ??
    (range
      ? text.slice(offsetAt(text, range.start), offsetAt(text, range.end))
      : wordAt(view));
  return { name, position };
}
export async function rename(
  view: EditorView,
  position: LspPosition,
  newName: string,
) {
  const plugin = pluginOf(view);
  plugin.client.sync();
  const edit = await plugin.client.request<unknown, WorkspaceEdit | null>(
    "textDocument/rename",
    { textDocument: { uri: plugin.uri }, position, newName },
  );
  if (!edit) throw new Error("The language server made no changes.");
  return applyWorkspaceEdit(edit, `Rename to ${newName}`);
}

export interface CodeAction {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  edit?: WorkspaceEdit;
  command?: { command: string; arguments?: unknown[] } | string;
  arguments?: unknown[];
}
export async function codeActions(view: EditorView) {
  const plugin = pluginOf(view);
  plugin.client.sync();
  const { from, to } = view.state.selection.main;
  const start = plugin.toPosition(from),
    end = plugin.toPosition(to);
  const path = fromUri(plugin.uri);
  const diagnostics = diagnosticsOf(path).filter(
    (d) => d.range.start.line <= end.line && d.range.end.line >= start.line,
  );
  const actions = await plugin.client.request<unknown, CodeAction[] | null>(
    "textDocument/codeAction",
    {
      textDocument: { uri: plugin.uri },
      range: { start, end },
      context: { diagnostics },
    },
  );
  return (actions ?? []).sort(
    (a, b) => Number(!!b.isPreferred) - Number(!!a.isPreferred),
  );
}
export async function runCodeAction(view: EditorView, action: CodeAction) {
  const plugin = pluginOf(view);
  if (action.edit) await applyWorkspaceEdit(action.edit, action.title);
  const command =
    typeof action.command === "string"
      ? { command: action.command, arguments: action.arguments }
      : action.command;
  if (command) await plugin.client.request("workspace/executeCommand", command);
}

/** Formats the document (or the selection) and applies the result if nothing changed
 * meanwhile. Returns false without a server or formatter. */
export async function format(
  view: EditorView,
  selection = false,
  path: string | null = null,
) {
  const plugin = LSPPlugin.get(view);
  if (!plugin) return false;
  const capability = selection
    ? "documentRangeFormattingProvider"
    : "documentFormattingProvider";
  if (!plugin.client.serverCapabilities?.[capability]) return false;
  plugin.client.sync();
  const settings = settingsFor(path);
  const before = view.state.doc;
  const { from, to } = view.state.selection.main;
  const edits = await plugin.client.request<unknown, TextEdit[] | null>(
    selection ? "textDocument/rangeFormatting" : "textDocument/formatting",
    {
      textDocument: { uri: plugin.uri },
      options: {
        tabSize: settings.tabSize,
        insertSpaces: settings.insertSpaces,
      },
      ...(selection
        ? {
            range: {
              start: plugin.toPosition(from),
              end: plugin.toPosition(to),
            },
          }
        : {}),
    },
  );
  if (view.state.doc !== before)
    throw new Error(
      "The document changed while it was being formatted; try again.",
    );
  if (edits?.length)
    view.dispatch({
      changes: resolveEdits(before.toString(), edits),
      userEvent: "input.format",
    });
  return true;
}

export interface OutlineSymbol {
  name: string;
  detail: string;
  kind: number;
  start: LspPosition;
  children: OutlineSymbol[];
}
export async function documentSymbols(
  view: EditorView,
): Promise<OutlineSymbol[] | null> {
  const plugin = LSPPlugin.get(view);
  if (!plugin || !plugin.client.serverCapabilities?.documentSymbolProvider)
    return null;
  plugin.client.sync();
  const response = await plugin.client.request<unknown, any[] | null>(
    "textDocument/documentSymbol",
    { textDocument: { uri: plugin.uri } },
  );
  const convert = (symbol: any): OutlineSymbol => ({
    name: symbol.name,
    detail: symbol.detail ?? symbol.containerName ?? "",
    kind: symbol.kind,
    start: (symbol.selectionRange ?? symbol.location?.range ?? symbol.range)
      .start,
    children: (symbol.children ?? []).map(convert),
  });
  return (response ?? []).map(convert);
}

/** Relative path for display, or the full path outside the project. */
export function displayPath(path: string) {
  const project = projectFor(path);
  return (project?.root && relative(project.root, path)) || path;
}
