import { describe, expect, it } from "vitest";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { addNextMatch, countText, preserveCase } from "./find";

/** Just what Add Selection to Next Find Match uses of a view: its state and dispatch. */
function fakeView(doc: string, selection: EditorSelection) {
  const view = {
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true), search()],
    }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view;
}
const picked = (view: { state: EditorState }) =>
  view.state.selection.ranges.map((r) => [r.from, r.to]);

describe("find widget", () => {
  it("keeps the match's case in a replacement, as VS Code's Preserve Case", () => {
    expect(preserveCase("FOO", "bar")).toBe("BAR");
    expect(preserveCase("foo", "Bar")).toBe("bar");
    expect(preserveCase("Foo", "bar")).toBe("Bar");
    expect(preserveCase("fOo", "bar")).toBe("bar");
    expect(preserveCase("123", "Bar")).toBe("Bar");
  });

  it("counts the matches and the one the selection is on", () => {
    const ranges = [
      { from: 0, to: 3 },
      { from: 10, to: 13 },
    ];
    expect(countText(ranges, { from: 10, to: 13 })).toBe("2 of 2");
    expect(countText(ranges, { from: 5, to: 5 })).toBe("? of 2");
    expect(countText([], { from: 0, to: 0 })).toBe("No results");
    expect(countText(null, { from: 0, to: 0 })).toBe("9999+");
  });
});

describe("Add Selection to Next Find Match (Ctrl+D)", () => {
  const press = (view: ReturnType<typeof fakeView>) =>
    addNextMatch(view as unknown as EditorView);

  it("selects the word at a cursor, then adds whole, same-case words", () => {
    const view = fakeView(
      "foo Foo foobar foo",
      EditorSelection.create([EditorSelection.cursor(1)]),
    );
    expect(press(view)).toBe(true);
    expect(picked(view)).toEqual([[0, 3]]);
    expect(press(view)).toBe(true);
    // "Foo" differs in case and "foobar" is not the whole word.
    expect(picked(view)).toEqual([
      [0, 3],
      [15, 18],
    ]);
    expect(view.state.selection.main.from).toBe(15);
    // Nothing else matches: the selections stay.
    expect(press(view)).toBe(false);
  });

  it("matches a selection's text in any case by default, wrapping around", () => {
    const view = fakeView(
      "ab x AB ab",
      EditorSelection.create([EditorSelection.range(5, 7)]),
    );
    press(view);
    expect(picked(view)).toEqual([
      [5, 7],
      [8, 10],
    ]);
    press(view);
    expect(picked(view)).toEqual([
      [0, 2],
      [5, 7],
      [8, 10],
    ]);
  });

  it("takes Match Case and Whole Word from the find widget for a selection", () => {
    const view = fakeView(
      "ab AB abc ab",
      EditorSelection.create([EditorSelection.range(0, 2)]),
    );
    view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ search: "", caseSensitive: true, wholeWord: true }),
      ),
    });
    press(view);
    expect(picked(view)).toEqual([
      [0, 2],
      [10, 12],
    ]);
  });
});
