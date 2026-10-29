import {
  HighlightStyle,
  LanguageDescription,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { Extension } from "@codemirror/state";
import { tags } from "@lezer/highlight";

// Readable on the dark editor background (the default style targets light themes).
export const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
    ],
    color: "#c6a0f6",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#7fd1c7" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.macroName,
    ],
    color: "#8ab4f8",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "#a5d6a7",
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#f2b880" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "#7a8494",
    fontStyle: "italic",
  },
  { tag: [tags.processingInstruction, tags.meta], color: "#e2b77e" },
  { tag: [tags.propertyName, tags.attributeName], color: "#b8c7e0" },
  { tag: tags.heading, color: "#8ab4f8", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "#f28b82" },
]);

/** Highlighting for a file name's language, loaded on demand; none for unknown types. */
export async function language(name: string): Promise<Extension> {
  const description = LanguageDescription.matchFilename(languages, name);
  if (!description) return [];
  return [syntaxHighlighting(highlight), await description.load()];
}
