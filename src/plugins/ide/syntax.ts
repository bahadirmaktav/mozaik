import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";
import { cmake } from "./cmakeLanguage";
import { serverFor } from "./paths";

// The theme's highlighting colors (`--syntax-*`, see `workspace/themes.ts`).
export const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
    ],
    color: "var(--syntax-keyword)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--syntax-type)",
  },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.macroName,
    ],
    color: "var(--syntax-function)",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "var(--syntax-string)",
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: "var(--syntax-number)",
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "var(--syntax-comment)",
    fontStyle: "italic",
  },
  {
    tag: [tags.processingInstruction, tags.meta],
    color: "var(--syntax-meta)",
  },
  {
    tag: [
      tags.propertyName,
      tags.attributeName,
      tags.special(tags.variableName),
    ],
    color: "var(--syntax-property)",
  },
  { tag: tags.heading, color: "var(--syntax-function)", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "var(--syntax-invalid)" },
]);

/**
 * C and C++: the colors of the chosen C++ theme (`cppThemes.ts`), which set `--cpp-*`; without
 * one, the color theme's.
 */
const cpp = (token: string, fallback: string) =>
  `var(--cpp-${token}, var(--syntax-${fallback}))`;
const cppHighlight = HighlightStyle.define([
  // `int` and its kind look like keywords, as in VS Code.
  {
    tag: [tags.keyword, tags.modifier, tags.standard(tags.typeName)],
    color: cpp("keyword", "keyword"),
  },
  {
    tag: [tags.controlKeyword, tags.operatorKeyword],
    color: cpp("control", "keyword"),
  },
  {
    tag: [tags.typeName, tags.className],
    color: cpp("type", "type"),
  },
  { tag: tags.namespace, color: cpp("namespace", "type") },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: cpp("function", "function"),
  },
  { tag: tags.macroName, color: cpp("macro", "function") },
  {
    tag: [tags.string, tags.special(tags.string)],
    color: cpp("string", "string"),
  },
  {
    tag: [tags.number, tags.bool, tags.null, tags.atom],
    color: cpp("number", "number"),
  },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: cpp("comment", "comment"),
    fontStyle: "italic",
  },
  {
    tag: [tags.processingInstruction, tags.meta],
    color: cpp("meta", "meta"),
  },
  {
    tag: [tags.propertyName, tags.special(tags.variableName)],
    color: cpp("property", "property"),
  },
  { tag: tags.variableName, color: "var(--cpp-variable, inherit)" },
  { tag: tags.invalid, color: "var(--syntax-invalid)" },
]);

/** Highlighting for a file name's language, loaded on demand; none for unknown types. */
export async function language(name: string): Promise<Extension> {
  // Mozaik's own CMake language: richer highlighting and completion (`cmakeLanguage.ts`).
  if (/^cmakelists\.txt$|\.cmake(\.in)?$/i.test(name))
    return [syntaxHighlighting(highlight), cmake()];
  const description = LanguageDescription.matchFilename(languages, name);
  if (!description) return [];
  return [
    syntaxHighlighting(serverFor(name) ? cppHighlight : highlight),
    await description.load(),
  ];
}
