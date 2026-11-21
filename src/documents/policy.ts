// See docs/decisions/002-editor-and-data.md for the measured basis and limitations.
export const LIGHTWEIGHT_AT = 1024 * 1024;
export const lightweight = (text: string) => text.length >= LIGHTWEIGHT_AT;
