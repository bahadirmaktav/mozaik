import type { Limits } from "../workspace/model";
import { ideZoom } from "../workspace/ideZoom";
import { textEditor } from "./text-editor/definition";
import { terminal } from "./terminal/definition";
import { fileManager } from "./file-manager/definition";
import { tasks } from "./tasks/definition";
import { excalidraw } from "./excalidraw/definition";
import { mermaid } from "./mermaid/definition";
import { notesPlugin } from "./notes/definition";
import { calculatorPlugin } from "./calculator/definition";
import {
  codeEditor,
  codeView,
  coverage,
  diff,
  fileTab,
  ideAgent,
  idePanel,
  ideProject,
  ideStatus,
} from "./ide/definition";
import { drawingFiles } from "./excalidraw/drawings";
import { diagramFiles } from "./mermaid/diagrams";

// The workspace's modules: each defines itself in its own `definition.ts`; this list and the
// App assemble them (docs/decisions/034-module-boundaries.md).
export {
  calculatorPlugin,
  codeEditor,
  codeView,
  coverage,
  diff,
  excalidraw,
  fileManager,
  fileTab,
  ideAgent,
  idePanel,
  ideProject,
  ideStatus,
  mermaid,
  notesPlugin,
  tasks,
  terminal,
  textEditor,
};

/** Modules whose items are files that save themselves once bound to a path. `snapshot` is
 * the recovery kind of their unsaved contents. */
export const fileModules = [
  { plugin: excalidraw, files: drawingFiles, snapshot: "drawing" },
  { plugin: mermaid, files: diagramFiles, snapshot: "mermaid" },
] as const;
export type FileModule = (typeof fileModules)[number];
export const registry = new Map([
  [textEditor.id, textEditor],
  [terminal.id, terminal],
  [fileManager.id, fileManager],
  [tasks.id, tasks],
  [excalidraw.id, excalidraw],
  [mermaid.id, mermaid],
  [notesPlugin.id, notesPlugin],
  [calculatorPlugin.id, calculatorPlugin],
  [ideProject.id, ideProject],
  [codeEditor.id, codeEditor],
  [codeView.id, codeView],
  [fileTab.id, fileTab],
  [ideAgent.id, ideAgent],
  [idePanel.id, idePanel],
  [ideStatus.id, ideStatus],
  [diff.id, diff],
  [coverage.id, coverage],
]);
const scaled = new Map<number, Limits>();
/**
 * The plugins' sizes at an IDE zoom (`workspace/ideZoom.ts`): the docked IDE bars grow with
 * their text, while the panel border (2px) stays.
 */
export function limitsAt(zoom: number): Limits {
  let limits = scaled.get(zoom);
  if (!limits) {
    limits = Object.fromEntries(
      [...registry].map(([id, plugin]) => [
        id,
        {
          ...plugin.minimum,
          dock: plugin.dock && {
            ...plugin.dock,
            size: Math.round((plugin.dock.size - 2) * zoom) + 2,
          },
        },
      ]),
    );
    scaled.set(zoom, limits);
  }
  return limits;
}
/** The plugins' sizes at the current IDE zoom. */
export const pluginLimits = () => limitsAt(ideZoom());
