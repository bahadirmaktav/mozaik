import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

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
    tag: [tags.propertyName, tags.attributeName],
    color: "var(--syntax-property)",
  },
  { tag: tags.heading, color: "var(--syntax-function)", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "var(--syntax-invalid)" },
]);

/** Highlighting for a file name's language, loaded on demand; none for unknown types. */
export async function language(name: string): Promise<Extension> {
  const description = LanguageDescription.matchFilename(languages, name);
  if (!description) return [];
  return [syntaxHighlighting(highlight), await description.load()];
}
