/**
 * Files other modules (the File Manager) open in a Text Editor. App sets the opener, which
 * knows the workspace: it opens a file in the panel it was dropped on, else in a Text
 * Editor panel of the workspace, else in a new panel beside.
 */
interface TextOpener {
  open(paths: string[], panelId?: string): void;
  /** Whether a drop on this panel opens files there: it shows a Text Editor. */
  accepts(panelId: string): boolean;
}
let opener: TextOpener | null = null;
export function setTextOpener(next: TextOpener | null) {
  opener = next;
}
export const textFiles = {
  /** False without an opener; the caller then opens the files as before. */
  open(paths: string[], panelId?: string) {
    if (!opener) return false;
    opener.open(paths, panelId);
    return true;
  },
  accepts: (panelId: string) => opener?.accepts(panelId) ?? false,
};

// Media, documents and archives go to their default application without being read.
const BINARY =
  /\.(png|jpe?g|gif|bmp|webp|ico|tiff?|psd|pdf|zip|7z|rar|gz|tgz|bz2|xz|tar|iso|mp3|m4a|wav|flac|ogg|mp4|mkv|avi|mov|webm|docx?|xlsx?|pptx?|odt|ods|odp|exe|dll|so|dylib|msi|bin)$/i;
export const textLike = (path: string) => !BINARY.test(path);
/** A read refused because the file is not text (rather than a text file with a problem). */
export const notText = (error: unknown) =>
  /binary file|Unsupported encoding|allocation safety limit/.test(
    String(error),
  );
