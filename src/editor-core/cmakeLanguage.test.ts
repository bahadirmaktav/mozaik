import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { cmake, cmakeLanguage, definitions, place } from "./cmakeLanguage";

const classes = tagHighlighter([
  { tag: tags.function(tags.variableName), class: "command" },
  { tag: tags.controlKeyword, class: "control" },
  { tag: tags.keyword, class: "keyword" },
  { tag: tags.special(tags.variableName), class: "variable" },
  { tag: tags.meta, class: "generator" },
  { tag: tags.string, class: "string" },
  { tag: tags.comment, class: "comment" },
  { tag: tags.bool, class: "bool" },
]);
/** The highlighted pieces of a text: `class:text`. */
function tokens(text: string) {
  const out: string[] = [];
  highlightTree(cmakeLanguage.parser.parse(text), classes, (from, to, cls) =>
    out.push(`${cls}:${text.slice(from, to)}`),
  );
  return out;
}

describe("CMake highlighting", () => {
  it("colors commands, control flow, variables, keywords and generator expressions", () => {
    expect(
      tokens(
        'if(WIN32)\n  target_link_libraries(app PRIVATE "${LIBS}" $<TARGET_FILE:app> ON)\nendif()',
      ),
    ).toEqual([
      "control:if",
      "keyword:WIN32",
      "command:target_link_libraries",
      "keyword:PRIVATE",
      'string:"',
      "variable:${LIBS}",
      'string:"',
      "generator:$<TARGET_FILE:app>",
      "bool:ON",
      "control:endif",
    ]);
  });
  it("reads bracket comments and arguments over several lines", () => {
    const pieces = tokens("#[[ one\ntwo ]]\nset(X [=[ a\n]] b ]=])");
    expect(pieces).toContain("comment:#[[ one");
    expect(pieces).toContain("comment:two ]]");
    expect(pieces).toContain("string:]] b ]=]");
    expect(pieces).toContain("command:set");
  });
  it("leaves a word that is not followed by a parenthesis plain", () => {
    expect(tokens("project")).toEqual([]);
  });
});
describe("CMake completion", () => {
  it("finds the targets, variables and functions a file defines", () => {
    const found = definitions(
      'add_executable(app main.cpp)\nadd_library(core STATIC a.cpp)\nset(SOURCES a.cpp)\noption(USE_X "x" ON)\nfunction(my_helper)\nendfunction()',
    );
    expect([...found.targets]).toEqual(["app", "core"]);
    expect([...found.variables]).toEqual(["SOURCES", "USE_X"]);
    expect([...found.commands]).toEqual(["my_helper"]);
  });
  it("tells a command name from its arguments and a variable reference", () => {
    expect(place("project(demo)\nadd_")).toBe("command");
    expect(place("target_link_libraries(app PR")).toBe("argument");
    expect(place('message("${CMAKE_')).toBe("variable");
    expect(place("set(A b) # a ( in a comment\nse")).toBe("command");
    expect(place('message("a ( b")\nfo')).toBe("command");
  });
  it("offers targets and keywords in arguments, commands at the start", () => {
    const run = (text: string) => {
      const state = EditorState.create({ doc: text, extensions: cmake() });
      const [source] = state.languageDataAt<
        (c: CompletionContext) => CompletionResult | null
      >("autocomplete", text.length);
      return source(
        new CompletionContext(state, text.length, true),
      )!.options.map((o) => o.label);
    };
    const args = run("add_library(core a.cpp)\ntarget_link_libraries(app ");
    expect(args[0]).toBe("core");
    expect(args).toContain("PRIVATE");
    expect(run("add_")).toContain("add_executable");
    expect(run("message(${CMAKE_")).toContain("CMAKE_BUILD_TYPE");
  });
});
