/// <reference types="vite/client" />

declare module "mozaik-browser-fs-access" {
  export { fileOpen } from "browser-fs-access";
}
interface Window {
  EXCALIDRAW_ASSET_PATH?: string | string[];
}
