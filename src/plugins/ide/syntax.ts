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

/** The language of files no grammar is known for. */
export const PLAIN_TEXT = "Plain Text";
/** Every language a file can be shown as, alphabetically, Plain Text first. */
export function languageNames() {
  const names = new Set(languages.map((l) => l.name));
  names.delete(PLAIN_TEXT);
  return [
    PLAIN_TEXT,
    ...[...names].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    ),
  ];
}
/** The language detected from a file name: its extension or whole name. */
export function detectedLanguage(name: string) {
  if (/^cmakelists\.txt$|\.cmake(\.in)?$/i.test(name)) return "CMake";
  // JSON with comments (VS Code's settings, tsconfig) and JSON5 read as JSON.
  if (/\.json[c5]$/i.test(name)) return "JSON";
  return LanguageDescription.matchFilename(languages, name)?.name ?? PLAIN_TEXT;
}
/** Highlighting for a language by name (`detectedLanguage`, `languageNames`), loaded on
 * demand; none for Plain Text. */
export async function languageNamed(
  language: string,
  file = "",
): Promise<Extension> {
  // Mozaik's own CMake language: richer highlighting and completion (`cmakeLanguage.ts`).
  if (language === "CMake") return [syntaxHighlighting(highlight), cmake()];
  const description = languages.find((l) => l.name === language);
  if (!description) return [];
  const cLike =
    serverFor(file) ||
    ["C", "C++", "Objective-C", "Objective-C++"].includes(language);
  return [
    syntaxHighlighting(cLike ? cppHighlight : highlight),
    await description.load(),
  ];
}
/** Highlighting for a file name's language, loaded on demand; none for unknown types. */
export function language(name: string): Promise<Extension> {
  return languageNamed(detectedLanguage(name), name);
}
