import { describe, expect, it } from "vitest";
import { fit, MAX_SCALE, MIN_SCALE, wheelFactor, zoomAt } from "./panZoomModel";

describe("pan and zoom", () => {
  it("fits a large picture and centers it", () => {
    const view = fit(
      { width: 2000, height: 500 },
      { width: 1032, height: 800 },
    );
    expect(view.scale).toBe(0.5);
    expect(view.x).toBe(16);
    expect(view.y).toBe(275);
  });
  it("keeps a small picture at its own size", () => {
    expect(
      fit({ width: 100, height: 100 }, { width: 500, height: 500 }),
    ).toEqual({ scale: 1, x: 200, y: 200 });
  });
  it("keeps the point under the pointer in place", () => {
    const before = { scale: 2, x: 30, y: -10 };
    const after = zoomAt(before, 1.5, 100, 200);
    const picture = (view: typeof before, p: number, offset: number) =>
      (p - offset) / view.scale;
    expect(picture(after, 100, after.x)).toBeCloseTo(
      picture(before, 100, before.x),
    );
    expect(picture(after, 200, after.y)).toBeCloseTo(
      picture(before, 200, before.y),
    );
  });
  it("stays within its limits", () => {
    const view = { scale: 1, x: 0, y: 0 };
    expect(zoomAt(view, 1e6, 0, 0).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, 1e-6, 0, 0).scale).toBe(MIN_SCALE);
  });
  it("zooms in on a wheel turned up and bounds a large step", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(100000)).toBe(wheelFactor(100));
  });
});
