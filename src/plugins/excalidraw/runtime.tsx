import "./assets";
import { createRoot, type Root } from "react-dom/client";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  hashElementsVersion,
  isElementLink,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  UIOptions,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  baseName,
  content,
  getDrawing,
  hasDrawing,
  registerRuntime,
  reportError,
  requestOpen,
  saveDrawing,
  setScene,
  useDrawing,
} from "./drawings";
import { setNativeSave } from "./fs-access";
import { drawingsBackend, type ExportExtension } from "../../services/drawings";

interface Live {
  // Moved between views so the scene, selection and undo history survive remounts.
  element: HTMLDivElement;
  root: Root;
  api: ExcalidrawImperativeAPI | null;
  /** Fingerprint of the persisted scene; `null` until the loaded scene is known. */
  key: string | null;
  /** Set by the first user input; changes before it (loading, font metrics) are not edits. */
  touched: boolean;
  pointer: boolean;
  pending: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}
// Serializing a scene with images is not free; wait for a pause and never during a drag.
const SERIALIZE_MS = 300;
const lives: Map<string, Live> =
  import.meta.hot?.data.excalidrawRuntimes ?? new Map();
if (import.meta.hot) import.meta.hot.data.excalidrawRuntimes = lives;
// Excalidraw's own file actions keep their own buttons; only those that would write a drawing
// outside Tessera's save path are replaced by the menu items below.
const UI: Partial<UIOptions> = {
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
};
const EXPORTS: ExportExtension[] = ["png", "svg", "excalidrawlib"];

setNativeSave(async (data, name) => {
  const extension = name.split(".").pop()?.toLowerCase() as ExportExtension;
  try {
    if (!EXPORTS.includes(extension))
      throw new Error(`Tessera cannot export .${extension} files.`);
    return (await drawingsBackend.export(data, name, extension)) !== null;
  } catch (error) {
    reportError(error);
    return false;
  }
});

function theme() {
  return getComputedStyle(document.documentElement).colorScheme === "light"
    ? "light"
    : "dark";
}
function fingerprint(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) {
  return [
    hashElementsVersion(elements),
    appState.viewBackgroundColor,
    appState.gridSize,
    appState.gridStep,
    appState.gridModeEnabled,
    Object.keys(files).join(),
  ].join("|");
}
function serialize(id: string, live: Live) {
  clearTimeout(live.timer);
  live.pending = false;
  const api = live.api;
  if (!api || !hasDrawing(id)) return;
  setScene(
    id,
    serializeAsJSON(
      api.getSceneElements(),
      api.getAppState(),
      api.getFiles(),
      "local",
    ),
  );
}
function schedule(id: string, live: Live) {
  live.pending = true;
  clearTimeout(live.timer);
  live.timer = setTimeout(() => {
    if (live.pointer) schedule(id, live);
    else serialize(id, live);
  }, SERIALIZE_MS);
}
function changed(
  id: string,
  live: Live,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
) {
  if (appState.isLoading) return;
  const key = fingerprint(elements, appState, files);
  if (key === live.key) return;
  live.key = key;
  if (live.touched) schedule(id, live);
}
function reload(live: Live, text: string) {
  const api = live.api;
  if (!api) return;
  const data = JSON.parse(text);
  live.key = null;
  api.updateScene({
    elements: restoreElements(data.elements, null),
    appState: {
      viewBackgroundColor: data.appState?.viewBackgroundColor,
      gridSize: data.appState?.gridSize,
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  api.addFiles(Object.values(data.files ?? {}));
  // The previous history would apply to a scene that is no longer there.
  api.history.clear();
}

function Scene({
  id,
  live,
  initial,
}: {
  id: string;
  live: Live;
  initial: ExcalidrawInitialDataState | null;
}) {
  const drawing = useDrawing(id);
  return (
    <Excalidraw
      initialData={initial}
      excalidrawAPI={(api) => {
        live.api = api;
      }}
      theme={theme()}
      name={drawing ? baseName(drawing.name) : undefined}
      onChange={(elements, appState, files) =>
        changed(id, live, elements, appState, files)
      }
      onPointerDown={() => {
        live.pointer = true;
      }}
      onPointerUp={() => {
        live.pointer = false;
      }}
      UIOptions={UI}
      // Embeds would load remote pages; Tessera is offline.
      validateEmbeddable={() => false}
      onLinkOpen={(element, event) => {
        if (isElementLink(element.link ?? "")) return;
        event.preventDefault();
        live.api?.setToast({
          message: "Tessera does not open web links.",
          closable: true,
        });
      }}
    >
      <MainMenu>
        <MainMenu.Item onSelect={() => requestOpen()} shortcut="Ctrl+O">
          Open…
        </MainMenu.Item>
        <MainMenu.Item
          onSelect={() => void saveDrawing(id).catch(reportError)}
          shortcut="Ctrl+S"
        >
          Save
        </MainMenu.Item>
        <MainMenu.Item
          onSelect={() => void saveDrawing(id, true).catch(reportError)}
          shortcut="Ctrl+Shift+S"
        >
          Save as…
        </MainMenu.Item>
        <MainMenu.DefaultItems.SaveAsImage />
        <MainMenu.DefaultItems.SearchMenu />
        <MainMenu.DefaultItems.Help />
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.Separator />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
      <WelcomeScreen>
        <WelcomeScreen.Hints.MenuHint />
        <WelcomeScreen.Hints.ToolbarHint />
        <WelcomeScreen.Hints.HelpHint />
        <WelcomeScreen.Center>
          <WelcomeScreen.Center.Logo />
          <WelcomeScreen.Center.Heading>
            Diagrams. Made. Simple.
          </WelcomeScreen.Center.Heading>
          <WelcomeScreen.Center.Menu>
            <WelcomeScreen.Center.MenuItem
              onSelect={() => requestOpen()}
              shortcut="Ctrl+O"
            >
              Open
            </WelcomeScreen.Center.MenuItem>
            <WelcomeScreen.Center.MenuItemHelp />
          </WelcomeScreen.Center.Menu>
        </WelcomeScreen.Center>
      </WelcomeScreen>
    </Excalidraw>
  );
}

function create(id: string): Live {
  const element = document.createElement("div");
  element.className = "excalidraw-surface";
  const live: Live = {
    element,
    root: createRoot(element),
    api: null,
    key: null,
    touched: false,
    pointer: false,
    pending: false,
    timer: undefined,
  };
  for (const type of ["pointerdown", "keydown", "paste", "drop"])
    element.addEventListener(type, () => (live.touched = true), true);
  const text = content(getDrawing(id));
  const data = text ? JSON.parse(text) : null;
  const initial: ExcalidrawInitialDataState | null = data && {
    elements: data.elements,
    appState: data.appState,
    files: data.files,
    scrollToContent: true,
  };
  live.root.render(<Scene id={id} live={live} initial={initial} />);
  lives.set(id, live);
  registerRuntime(id, {
    flush: () => {
      if (live.pending) serialize(id, live);
    },
    reload: (text) => reload(live, text),
    dispose: () => {
      clearTimeout(live.timer);
      lives.delete(id);
      element.remove();
      // Not inside the React commit that closed the tab.
      queueMicrotask(() => live.root.unmount());
    },
  });
  return live;
}
export function attach(id: string, host: HTMLElement) {
  const live = lives.get(id) ?? create(id);
  host.append(live.element);
  // Pointer coordinates depend on the canvas offset, which changed with the new parent.
  const frame = requestAnimationFrame(() => live.api?.refresh());
  return {
    detach() {
      cancelAnimationFrame(frame);
      // Only the DOM node leaves; the scene keeps running.
      if (live.element.parentElement === host) live.element.remove();
    },
  };
}
export function focus(id: string) {
  lives
    .get(id)
    ?.element.querySelector<HTMLElement>(".excalidraw")
    ?.focus({ preventScroll: true });
}
/** Hands files dropped from the OS to Excalidraw's own drop handling at that point. */
export function dropFiles(id: string, files: File[], x: number, y: number) {
  const live = lives.get(id);
  if (!live) return;
  const point = document.elementFromPoint(x, y);
  const target =
    point && live.element.contains(point)
      ? point
      : live.element.querySelector(".excalidraw");
  if (!target) return;
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  live.touched = true;
  target.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      dataTransfer: transfer,
    }),
  );
}
