const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["avif", "image/avif"],
]);
/** The MIME type of an image Excalidraw accepts (and the editors show), from its extension. */
export const imageType = (path: string) =>
  IMAGE_TYPES.get(/\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase() ?? "");
