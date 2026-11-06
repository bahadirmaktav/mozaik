/** Where a picture lies in its viewport: its offset in pixels and its scale. */
export type View = { x: number; y: number; scale: number };
export type Size = { width: number; height: number };
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 16;
const MARGIN = 16;
const clampScale = (scale: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

/** The whole picture centered in the viewport; a small one stays at its own size. */
export function fit(content: Size, viewport: Size): View {
  const scale = clampScale(
    Math.min(
      1,
      (viewport.width - 2 * MARGIN) / Math.max(content.width, 1),
      (viewport.height - 2 * MARGIN) / Math.max(content.height, 1),
    ),
  );
  return {
    scale,
    x: (viewport.width - content.width * scale) / 2,
    y: (viewport.height - content.height * scale) / 2,
  };
}
/** Scales by `factor` keeping the point under (`px`, `py`) of the viewport where it is. */
export function zoomAt(view: View, factor: number, px: number, py: number) {
  const scale = clampScale(view.scale * factor);
  const ratio = scale / view.scale;
  return {
    scale,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  };
}
/** A wheel step's scale factor: the same for a mouse notch and a touchpad's small steps. */
export const wheelFactor = (deltaY: number) =>
  Math.exp(-Math.max(-100, Math.min(100, deltaY)) * 0.002);
