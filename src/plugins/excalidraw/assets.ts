// Must run before Excalidraw is evaluated: fonts load from the app, never from a CDN.
// Production builds copy them to /excalidraw/fonts (see vite.config.ts).
window.EXCALIDRAW_ASSET_PATH = import.meta.env.DEV
  ? "/node_modules/@excalidraw/excalidraw/dist/prod/"
  : "/excalidraw/";
