import type { EditorState } from "@codemirror/state";
import { createBoundFiles, type BoundFile } from "../shared/boundFiles";

export type Diagram = BoundFile;
export { content, dirty } from "../shared/boundFiles";

/** A new diagram starts with an editable example; it is saved only through Save As. */
export const STARTER = `flowchart LR
  idea[Idea] --> draft[Draft]
  draft --> review{Review}
  review -->|ok| done[Done]
  review -->|changes| draft
`;
export const diagramFiles = createBoundFiles({
  kind: "mermaid",
  extensions: ["mmd", "mermaid"],
  empty: STARTER,
  noun: "diagram",
});
interface ViewState {
  /** Share of the source editor in the split, kept across remounts. */
  ratio: number;
  editor: EditorState | null;
}
const views: Map<string, ViewState> =
  import.meta.hot?.data.diagramViews ?? new Map();
if (import.meta.hot) import.meta.hot.data.diagramViews = views;
export function viewState(id: string) {
  let view = views.get(id);
  if (!view) views.set(id, (view = { ratio: 0.5, editor: null }));
  return view;
}
export function disposeDiagram(id: string) {
  views.delete(id);
  diagramFiles.dispose(id);
}
export const isDiagramPath = diagramFiles.isPath;
