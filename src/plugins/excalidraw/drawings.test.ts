import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drawingsBackend,
  type SaveOutcome,
  type SaveRequest,
} from "../../services/drawings";
import type { FileData } from "../../services/native";
import {
  allDrawings,
  checkDrawing,
  createDrawing,
  dirty,
  disposeDrawing,
  getDrawing,
  openDrawingFile,
  saveDrawing,
  setScene,
  settleDrawing,
} from "./drawings";

const scene = (n: number) =>
  JSON.stringify({ type: "excalidraw", version: 2, elements: [n] });
const file = (text = scene(0), revision = "r1"): FileData => ({
  path: "C:/plan.excalidraw",
  name: "plan.excalidraw",
  text,
  revision,
  bom: false,
  ending: "lf",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
async function opened(text = scene(0)) {
  drawingsBackend.open = async () => ({ kind: "opened", file: file(text) });
  return (await openDrawingFile(null))!;
}
const original = { ...drawingsBackend };
afterEach(() => {
  allDrawings().forEach((d) => disposeDrawing(d.id));
  Object.assign(drawingsBackend, original);
  vi.useRealTimers();
});

describe("drawing store", () => {
  it("names new drawings Untitled, Untitled 2 and reuses freed names", () => {
    const first = createDrawing(),
      second = createDrawing();
    expect([getDrawing(first).name, getDrawing(second).name]).toEqual([
      "Untitled",
      "Untitled 2",
    ]);
    disposeDrawing(first);
    expect(getDrawing(createDrawing()).name).toBe("Untitled");
    expect(dirty(getDrawing(second))).toBe(false);
  });
  it("focuses the drawing that already shows a file instead of loading it again", async () => {
    const id = await opened();
    setScene(id, scene(1));
    expect(await opened(scene(9))).toBe(id);
    expect(getDrawing(id).text).toBe(scene(1));
  });
  it("keeps a new drawing and its scene when Save As is cancelled", async () => {
    const id = createDrawing();
    setScene(id, scene(1));
    drawingsBackend.save = async () => ({ kind: "cancelled" });
    expect(await saveDrawing(id)).toBe(false);
    expect(getDrawing(id)).toMatchObject({ path: null, text: scene(1) });
    expect(dirty(getDrawing(id))).toBe(true);
  });
  it("never lets an older save land after a newer one and keeps later edits dirty", async () => {
    vi.useFakeTimers();
    const id = await opened();
    const requests: SaveRequest[] = [];
    const gates: ReturnType<typeof deferred<SaveOutcome>>[] = [];
    drawingsBackend.save = (request) => {
      requests.push(request);
      const gate = deferred<SaveOutcome>();
      gates.push(gate);
      return gate.promise;
    };
    setScene(id, scene(1));
    await vi.advanceTimersByTimeAsync(1000);
    setScene(id, scene(2));
    await vi.advanceTimersByTimeAsync(1000);
    // The second autosave waits for the first.
    expect(requests.map((r) => r.text)).toEqual([scene(1)]);
    gates[0].resolve({ kind: "saved", file: file(scene(1), "r2") });
    await vi.advanceTimersByTimeAsync(0);
    expect(getDrawing(id).saved).toBe(scene(1));
    expect(dirty(getDrawing(id))).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(requests.map((r) => [r.text, r.revision])).toEqual([
      [scene(1), "r1"],
      [scene(2), "r2"],
    ]);
    gates[1].resolve({ kind: "saved", file: file(scene(2), "r3") });
    await vi.advanceTimersByTimeAsync(0);
    expect(dirty(getDrawing(id))).toBe(false);
  });
  it("stops autosaving on a conflict and keeps the edits", async () => {
    vi.useFakeTimers();
    const id = await opened();
    const save = vi.fn(async (): Promise<SaveOutcome> => ({
      kind: "conflict",
      message: "changed on disk",
    }));
    drawingsBackend.save = save;
    setScene(id, scene(1));
    await vi.advanceTimersByTimeAsync(1000);
    setScene(id, scene(2));
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(getDrawing(id)).toMatchObject({
      conflict: "changed on disk",
      text: scene(2),
    });
    await expect(saveDrawing(id)).rejects.toThrow("changed on disk");
  });
  it("keeps the edits and the error when a save fails", async () => {
    const id = await opened();
    setScene(id, scene(1));
    drawingsBackend.save = async () => {
      throw new Error("disk full");
    };
    await expect(saveDrawing(id)).rejects.toThrow("disk full");
    expect(getDrawing(id)).toMatchObject({ error: "disk full", saving: false });
    expect(dirty(getDrawing(id))).toBe(true);
  });
  it("finishes the pending autosave before closing asks anything", async () => {
    const id = await opened();
    drawingsBackend.save = async (request) => ({
      kind: "saved",
      file: file(request.text, "r2"),
    });
    setScene(id, scene(1));
    await settleDrawing(id);
    expect(dirty(getDrawing(id))).toBe(false);
  });
  it("reloads a clean drawing but marks a dirty one as conflicting", async () => {
    const clean = await opened();
    drawingsBackend.check = async () => file(scene(5), "r9");
    await checkDrawing(clean);
    expect(getDrawing(clean)).toMatchObject({
      saved: scene(5),
      revision: "r9",
      text: null,
    });
    setScene(clean, scene(6));
    drawingsBackend.check = async () => file(scene(7), "r10");
    await checkDrawing(clean);
    expect(getDrawing(clean).conflict).toContain("changed on disk");
    expect(getDrawing(clean).text).toBe(scene(6));
  });
  it("ignores its own write that lands while the disk is being checked", async () => {
    const id = await opened();
    const checked = deferred<FileData | null>();
    drawingsBackend.check = () => checked.promise;
    const save = deferred<SaveOutcome>();
    drawingsBackend.save = () => save.promise;
    const check = checkDrawing(id);
    setScene(id, scene(1));
    const saving = saveDrawing(id);
    checked.resolve(file(scene(1), "r2"));
    await check;
    expect(getDrawing(id).conflict).toBeNull();
    save.resolve({ kind: "saved", file: file(scene(1), "r2") });
    await saving;
    expect(getDrawing(id)).toMatchObject({ revision: "r2", conflict: null });
  });
});
