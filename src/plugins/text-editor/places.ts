import { useLayoutEffect, type RefObject } from "react";
import type { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { hasDocument } from "./documents";
import { pathKey } from "../ide/paths";

/**
 * Where each file was left in this window, as in VS Code, for the Text and Code Editors: a
 * hidden tab has no view and a closed file no state, so its scroll position and cursor wait
 * here. Never written to disk.
 */
interface Place {
  anchor: number;
  head: number;
  scroll: StateEffect<unknown>;
}
const places = new Map<string, Place>();
const measured = new WeakSet<EditorView>();
const key = (id: string, path: string | null) => (path ? pathKey(path) : id);

export const placeOf = (id: string, path: string | null) =>
  places.get(key(id, path));
/** A place's selection for a new state of the text: it may have become shorter since. */
export const placeSelection = (place: Place | undefined, length: number) =>
  place && {
    anchor: Math.min(place.anchor, length),
    head: Math.min(place.head, length),
  };
/** A view gone before its first measure never applied the place it was given. */
export function trackPlace(view: EditorView) {
  view.requestMeasure({ read: () => void measured.add(view) });
}
/**
 * Keeps the place when the view goes. A layout effect: by the time a passive cleanup runs the
 * editor has left the page and reads a scroll position of zero.
 */
export function useSavePlace(
  viewRef: RefObject<EditorView | null>,
  id: string,
  path: string | null,
) {
  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      if (!view || !measured.has(view)) return;
      if (!path && !hasDocument(id)) return;
      const { anchor, head } = view.state.selection.main;
      places.set(key(id, path), {
        anchor,
        head,
        scroll: view.scrollSnapshot(),
      });
    },
    [viewRef, id, path],
  );
}
