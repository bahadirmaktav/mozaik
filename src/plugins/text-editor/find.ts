import {
  EditorSelection,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  runScopeHandlers,
  type KeyBinding,
  type Panel,
  type ViewUpdate,
} from "@codemirror/view";
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
  selectMatches,
  selectNextOccurrence,
  SearchQuery,
  setSearchQuery,
} from "@codemirror/search";
import { matches } from "../../workspace/keybindings";

/**
 * Find / Replace as VS Code's find widget: a box floating at the top right of the text with
 * Match Case, Whole Word and Regular Expression in the find field, "3 of 12", previous and
 * next, Find in Selection and close; a twisty shows the replace field with Preserve Case,
 * Replace and Replace All. The Text Editor, the Code Editor, Notes and comparisons share it.
 */

/** Matches counted for "N of M"; more are shown as "9999+". */
const COUNT_LIMIT = 9999;

const setReplaceShown = StateEffect.define<boolean>();
/** Whether the widget shows its replace row (kept while it is closed, as in VS Code). */
const replaceShown = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setReplaceShown)) value = e.value;
    return value;
  },
});

type Scope = readonly { from: number; to: number }[];
const setScope = StateEffect.define<Scope>();
/** Find in Selection: the ranges searched, following edits; empty searches everything. */
const findScope = StateField.define<Scope>({
  create: () => [],
  update: (value, tr) => {
    for (const e of tr.effects) if (e.is(setScope)) return e.value;
    if (!value.length || !tr.docChanged) return value;
    return value.map((r) => ({
      from: tr.changes.mapPos(r.from, 1),
      to: tr.changes.mapPos(r.to, -1),
    }));
  },
  provide: (field) =>
    EditorView.decorations.from(field, (ranges) =>
      Decoration.set(
        ranges
          .filter((r) => r.to > r.from)
          .map((r) => scopeMark.range(r.from, r.to)),
        true,
      ),
    ),
});
const scopeMark = Decoration.mark({ class: "cm-findScope" });

/** The query's filter: only matches inside the Find in Selection ranges, when there are. */
function inScope(_match: string, state: EditorState, from: number, to: number) {
  const scope = state.field(findScope, false);
  return !scope?.length || scope.some((r) => from >= r.from && to <= r.to);
}

/** Searches typed in any editor, newest last, for Up and Down in the find field. */
const findHistory: string[] = [];
function remember(text: string) {
  if (!text) return;
  const at = findHistory.indexOf(text);
  if (at >= 0) findHistory.splice(at, 1);
  findHistory.push(text);
  if (findHistory.length > 50) findHistory.shift();
}

/** The replacement with the match's case: all upper, all lower or capitalized, as VS Code. */
export function preserveCase(match: string, replacement: string) {
  if (!/\p{L}/u.test(match) || !replacement) return replacement;
  if (match === match.toUpperCase() && match !== match.toLowerCase())
    return replacement.toUpperCase();
  if (match === match.toLowerCase()) return replacement.toLowerCase();
  const first = match[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase())
    return replacement[0].toUpperCase() + replacement.slice(1);
  return replacement;
}

/** CodeMirror's query type behind a SearchQuery (not exported): its matches and replacements. */
interface Match {
  from: number;
  to: number;
  precise?: boolean;
  match?: RegExpExecArray;
}
interface QueryType {
  nextMatch(state: EditorState, from: number, to: number): Match | null;
  matchAll(state: EditorState, limit: number): Match[] | null;
  getReplacement(match: Match): string;
}
const typeOf = (query: SearchQuery) =>
  (query as unknown as { create(): QueryType }).create();

/** Replaces the selected match and selects the next one; without one selected, finds it. */
function replaceOne(view: EditorView, preserve: boolean) {
  const query = getSearchQuery(view.state);
  const { state } = view;
  if (state.readOnly || !query.valid) return false;
  const type = typeOf(query);
  const { from, to } = state.selection.main;
  let next = type.nextMatch(state, from, from);
  if (!next) return false;
  const changes = [];
  if (next.precise !== false && next.from === from && next.to === to) {
    const text = type.getReplacement(next);
    changes.push({
      from,
      to,
      insert: preserve ? preserveCase(state.sliceDoc(from, to), text) : text,
    });
    next = type.nextMatch(state, next.from, next.to);
  }
  const changeSet = state.changes(changes);
  const selection =
    next && EditorSelection.single(next.from, next.to).map(changeSet);
  view.dispatch({
    changes: changeSet,
    selection: selection ?? undefined,
    effects: selection
      ? EditorView.scrollIntoView(selection.main, { y: "center" })
      : undefined,
    userEvent: "input.replace",
  });
  return true;
}
/** Replaces every match (inside the Find in Selection ranges, when there are). */
function replaceEvery(view: EditorView, preserve: boolean) {
  const query = getSearchQuery(view.state);
  const { state } = view;
  if (state.readOnly || !query.valid) return false;
  const type = typeOf(query);
  const changes = (type.matchAll(state, 1e9) ?? [])
    .filter((m) => m.precise !== false)
    .map((m) => {
      const text = type.getReplacement(m);
      return {
        from: m.from,
        to: m.to,
        insert: preserve
          ? preserveCase(state.sliceDoc(m.from, m.to), text)
          : text,
      };
    });
  if (!changes.length) return false;
  view.dispatch({
    changes,
    effects: EditorView.announce.of(`Replaced ${changes.length} matches.`),
    userEvent: "input.replace.all",
  });
  return true;
}

/** "N of M", "? of M" off a match, or "No results", as VS Code counts. */
export function countText(
  ranges: readonly { from: number; to: number }[] | null,
  selection: { from: number; to: number },
) {
  if (ranges === null) return `${COUNT_LIMIT}+`;
  if (!ranges.length) return "No results";
  const at = ranges.findIndex(
    (r) => r.from === selection.from && r.to === selection.to,
  );
  return `${at < 0 ? "?" : at + 1} of ${ranges.length}`;
}

const SVG = "http://www.w3.org/2000/svg";
const ICONS: Record<string, string> = {
  twisty: "M6 4l4 4-4 4",
  up: "M8 12V4M4 8l4-4 4 4",
  down: "M8 4v8M4 8l4 4 4-4",
  selection: "M2 4h12M2 8h12M2 12h7",
  close: "M4 4l8 8M12 4l-8 8",
};
function icon(name: string) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}
function button(
  className: string,
  name: string,
  content: string | SVGElement,
  onClick: () => void,
) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = name;
  b.setAttribute("aria-label", name.replace(/ \(.*\)$/, ""));
  b.append(content);
  // Keep the focus in the field while pressing.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}
function toggle(name: string, text: string, onClick: () => void) {
  const b = button("cm-find-toggle", name, text, onClick);
  b.setAttribute("aria-pressed", "false");
  return b;
}
const pressed = (b: HTMLButtonElement, on: boolean) =>
  b.setAttribute("aria-pressed", String(on));

class FindWidget implements Panel {
  dom = document.createElement("div");
  top = true;
  private findField = document.createElement("input");
  private replaceField = document.createElement("input");
  private count = document.createElement("span");
  private twisty: HTMLButtonElement;
  private caseButton: HTMLButtonElement;
  private wordButton: HTMLButtonElement;
  private regexpButton: HTMLButtonElement;
  private preserveButton: HTMLButtonElement;
  private scopeButton: HTMLButtonElement;
  private replaceRow = document.createElement("div");
  private preserve = false;
  private browsing = -1;
  private query: SearchQuery;

  constructor(private view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom.className = "cm-find";
    this.dom.setAttribute("role", "search");
    this.dom.addEventListener("keydown", (e) => this.keydown(e));

    this.twisty = button(
      "cm-find-twisty",
      "Toggle Replace",
      icon("twisty"),
      () => this.showReplace(!view.state.field(replaceShown)),
    );
    const rows = document.createElement("div");
    rows.className = "cm-find-rows";

    const findRow = document.createElement("div");
    findRow.className = "cm-find-row";
    const findBox = document.createElement("div");
    findBox.className = "cm-find-input";
    Object.assign(this.findField, {
      type: "text",
      placeholder: "Find",
      spellcheck: false,
    });
    this.findField.setAttribute("aria-label", "Find");
    this.findField.setAttribute("main-field", "true");
    this.findField.addEventListener("input", () => {
      this.browsing = -1;
      this.commit();
    });
    this.caseButton = toggle("Match Case (Alt+C)", "Aa", () =>
      this.commit({ caseSensitive: !this.query.caseSensitive }),
    );
    this.wordButton = toggle("Match Whole Word (Alt+W)", "ab", () =>
      this.commit({ wholeWord: !this.query.wholeWord }),
    );
    this.wordButton.classList.add("cm-find-word");
    this.regexpButton = toggle("Use Regular Expression (Alt+R)", ".*", () =>
      this.commit({ regexp: !this.query.regexp }),
    );
    findBox.append(
      this.findField,
      this.caseButton,
      this.wordButton,
      this.regexpButton,
    );
    this.count.className = "cm-find-count";
    this.count.setAttribute("aria-live", "polite");
    this.scopeButton = button(
      "cm-find-action cm-find-toggle",
      "Find in Selection (Alt+L)",
      icon("selection"),
      () => this.toggleScope(),
    );
    findRow.append(
      findBox,
      this.count,
      button("cm-find-action", "Previous Match (Shift+Enter)", icon("up"), () =>
        this.step(false),
      ),
      button("cm-find-action", "Next Match (Enter)", icon("down"), () =>
        this.step(true),
      ),
      this.scopeButton,
      button("cm-find-action", "Close (Escape)", icon("close"), () =>
        closeSearchPanel(view),
      ),
    );

    this.replaceRow.className = "cm-find-row";
    const replaceBox = document.createElement("div");
    replaceBox.className = "cm-find-input";
    Object.assign(this.replaceField, {
      type: "text",
      placeholder: "Replace",
      spellcheck: false,
    });
    this.replaceField.setAttribute("aria-label", "Replace");
    this.replaceField.addEventListener("input", () => this.commit());
    this.preserveButton = toggle("Preserve Case (Alt+P)", "AB", () => {
      this.preserve = !this.preserve;
      pressed(this.preserveButton, this.preserve);
    });
    replaceBox.append(this.replaceField, this.preserveButton);
    this.replaceRow.append(
      replaceBox,
      button("cm-find-action cm-find-text", "Replace (Enter)", "Replace", () =>
        replaceOne(view, this.preserve),
      ),
      button(
        "cm-find-action cm-find-text",
        "Replace All (Ctrl+Alt+Enter)",
        "All",
        () => replaceEvery(view, this.preserve),
      ),
    );
    rows.append(findRow, this.replaceRow);
    this.dom.append(this.twisty, rows);
    this.show(this.query);
    this.layout();
  }

  mount() {
    const replace = this.view.state.field(replaceShown);
    const field =
      replace && this.findField.value ? this.replaceField : this.findField;
    field.focus();
    field.select();
  }

  update(update: ViewUpdate) {
    let refresh = update.docChanged || update.selectionSet;
    for (const tr of update.transactions)
      for (const e of tr.effects) {
        if (e.is(setSearchQuery)) {
          if (!e.value.eq(this.query)) this.show(e.value);
          // A query from elsewhere (opening on a selection) keeps to Find in Selection.
          if (e.value.test !== inScope) {
            const query = new SearchQuery({ ...e.value, test: inScope });
            queueMicrotask(() =>
              this.view.dispatch({ effects: setSearchQuery.of(query) }),
            );
          }
          refresh = true;
        } else if (e.is(setReplaceShown) || e.is(setScope)) refresh = true;
      }
    if (refresh) this.layout();
  }

  /** Shows a query set elsewhere (opening with a selection, another view's search). */
  private show(query: SearchQuery) {
    this.query = query;
    this.findField.value = query.search;
    this.replaceField.value = query.replace;
  }

  /** The fields' query, with changed options, sent to the editor. */
  private commit(change: Partial<SearchQuery> = {}) {
    const query = new SearchQuery({
      search: this.findField.value,
      replace: this.replaceField.value,
      caseSensitive: change.caseSensitive ?? this.query.caseSensitive,
      regexp: change.regexp ?? this.query.regexp,
      wholeWord: change.wholeWord ?? this.query.wholeWord,
      test: inScope,
    });
    if (query.eq(this.query)) return;
    this.query = query;
    this.view.dispatch({ effects: setSearchQuery.of(query) });
  }

  private step(forward: boolean) {
    remember(this.findField.value);
    (forward ? findNext : findPrevious)(this.view);
  }

  private showReplace(on: boolean) {
    this.view.dispatch({ effects: setReplaceShown.of(on) });
    (on ? this.replaceField : this.findField).focus();
  }

  /** Find in Selection: the selected lines (the cursor's line without a selection). */
  private toggleScope() {
    const { state } = this.view;
    const on = !state.field(findScope).length;
    const ranges = on
      ? state.selection.ranges.map((r) =>
          r.empty
            ? {
                from: state.doc.lineAt(r.from).from,
                to: state.doc.lineAt(r.from).to,
              }
            : { from: r.from, to: r.to },
        )
      : [];
    this.view.dispatch({ effects: setScope.of(ranges) });
    // The same query again, so the matches are found again inside the ranges.
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({ ...this.query, test: inScope }),
      ),
    });
  }

  private browse(older: boolean) {
    if (!findHistory.length) return;
    if (this.browsing < 0) this.browsing = findHistory.length;
    this.browsing = Math.max(
      0,
      Math.min(findHistory.length - 1, this.browsing + (older ? -1 : 1)),
    );
    this.findField.value = findHistory[this.browsing];
    this.commit();
    this.findField.select();
  }

  private layout() {
    const { state } = this.view;
    const readOnly = state.readOnly;
    const replace = state.field(replaceShown) && !readOnly;
    this.twisty.hidden = readOnly;
    this.twisty.setAttribute("aria-expanded", String(replace));
    this.dom.classList.toggle("replacing", replace);
    this.replaceRow.hidden = !replace;
    pressed(this.caseButton, this.query.caseSensitive);
    pressed(this.wordButton, this.query.wholeWord);
    pressed(this.regexpButton, this.query.regexp);
    pressed(this.scopeButton, !!state.field(findScope).length);
    const invalid = !!this.query.search && !this.query.valid;
    this.findField.parentElement!.classList.toggle("invalid", invalid);
    if (!this.query.search || invalid) {
      this.count.textContent = this.query.search ? "Invalid" : "No results";
      this.count.classList.toggle("none", !!this.query.search);
      return;
    }
    const all = typeOf(this.query).matchAll(state, COUNT_LIMIT);
    const text = countText(all, state.selection.main);
    this.count.textContent = text;
    this.count.classList.toggle("none", text === "No results");
  }

  private keydown(event: KeyboardEvent) {
    const view = this.view;
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (event.altKey && plain) {
      const key = event.code;
      const act =
        key === "KeyC"
          ? () => this.commit({ caseSensitive: !this.query.caseSensitive })
          : key === "KeyW"
            ? () => this.commit({ wholeWord: !this.query.wholeWord })
            : key === "KeyR"
              ? () => this.commit({ regexp: !this.query.regexp })
              : key === "KeyL"
                ? () => this.toggleScope()
                : key === "KeyP"
                  ? () => {
                      this.preserve = !this.preserve;
                      pressed(this.preserveButton, this.preserve);
                    }
                  : key === "Enter"
                    ? () => selectMatches(view) && view.focus()
                    : null;
      if (act) {
        event.preventDefault();
        act();
        return;
      }
    }
    if (runScopeHandlers(view, event, "search-panel")) {
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && event.target === this.findField) {
      event.preventDefault();
      if (event.ctrlKey && event.altKey) replaceEvery(view, this.preserve);
      else this.step(!event.shiftKey);
    } else if (event.key === "Enter" && event.target === this.replaceField) {
      event.preventDefault();
      if (event.ctrlKey && event.altKey) replaceEvery(view, this.preserve);
      else replaceOne(view, this.preserve);
    } else if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !event.altKey &&
      !event.ctrlKey &&
      event.target === this.findField
    ) {
      event.preventDefault();
      this.browse(event.key === "ArrowUp");
    }
  }
}

/** Opens the widget, with the replace row for Replace, as Ctrl+F and Ctrl+H in VS Code. */
export function openFind(view: EditorView, replace: boolean) {
  const effects: StateEffect<unknown>[] = [];
  if (replace !== view.state.field(replaceShown, false))
    effects.push(setReplaceShown.of(replace && !view.state.readOnly));
  if (effects.length) view.dispatch({ effects });
  const wasOpen = searchPanelOpen(view.state);
  openSearchPanel(view);
  // Already open: openSearchPanel focused the find field; Replace goes to its own.
  if (wasOpen && replace) {
    const field = view.dom.querySelector<HTMLInputElement>(
      '.cm-find input[aria-label="Replace"]',
    );
    if (field && getSearchQuery(view.state).search) {
      field.focus();
      field.select();
    }
  }
  return true;
}

/** The find keys: Find and Replace from Workspace Settings, CodeMirror's next/previous. */
export const findKeys: readonly KeyBinding[] = [
  {
    any: (view, event) => {
      const replace = matches(event, "editor.replace");
      if (!replace && !matches(event, "editor.find")) return false;
      event.preventDefault();
      return openFind(view, replace);
    },
    scope: "editor search-panel",
  },
  // Its Ctrl+D is "Add selection to next match"; Ctrl+F is "editor.find".
  ...searchKeymap.filter(
    (b) => b.run !== selectNextOccurrence && b.run !== openSearchPanel,
  ),
];

/** Find / Replace: the widget, a match lands in the middle of the view. */
export const findPanel: Extension = [
  replaceShown,
  findScope,
  search({
    top: true,
    createPanel: (view) => new FindWidget(view),
    scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "center" }),
  }),
];
