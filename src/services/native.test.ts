import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { checkExternal, openFile, saveDocument, type FileData } from "./native";
import {
  allDocuments,
  createDocument,
  dirty,
  disposeDocument,
  getDocument,
  updateDocument,
} from "../plugins/text-editor/documents";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
const mocked = vi.mocked(invoke);
const file: FileData = {
  path: "C:/test.txt",
  name: "test.txt",
  text: "disk",
  revision: "r1",
  bom: true,
  ending: "crlf",
};
afterEach(() => {
  allDocuments().forEach((d) => disposeDocument(d.id));
  mocked.mockReset();
});
describe("document/native boundary", () => {
  it("opens one instance for a canonical file", async () => {
    mocked.mockResolvedValue(file);
    expect(await openFile()).toBe(await openFile());
    expect(allDocuments()).toHaveLength(1);
  });
  it("keeps typing during save dirty against the exact saved version", async () => {
    const id = createDocument({ ...file, saved: file.text });
    updateDocument(id, { text: "first edit" });
    let finish!: (value: FileData) => void;
    mocked.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const saving = saveDocument(id);
    await Promise.resolve();
    await Promise.resolve();
    updateDocument(id, { text: "newer edit" });
    finish({ ...file, text: "first edit", revision: "r2" });
    await saving;
    expect(getDocument(id).text).toBe("newer edit");
    expect(getDocument(id).saved).toBe("first edit");
    expect(dirty(getDocument(id))).toBe(true);
  });
  it("does not mark documents saved on dialog cancellation or write failure", async () => {
    const id = createDocument({ text: "unsaved" });
    mocked.mockResolvedValue(null);
    expect(await saveDocument(id)).toBe(false);
    expect(dirty(getDocument(id))).toBe(true);
    mocked.mockRejectedValue(new Error("read-only"));
    await expect(saveDocument(id)).rejects.toThrow("read-only");
    expect(getDocument(id).text).toBe("unsaved");
  });
  it("reloads clean content and preserves dirty edits on external change", async () => {
    const id = createDocument({ ...file, saved: file.text });
    mocked.mockResolvedValue({ ...file, text: "external", revision: "r2" });
    await checkExternal(id);
    expect(getDocument(id).text).toBe("external");
    expect(dirty(getDocument(id))).toBe(false);
    updateDocument(id, { text: "local" });
    mocked.mockResolvedValue({ ...file, text: "new external", revision: "r3" });
    await checkExternal(id);
    expect(getDocument(id).text).toBe("local");
    expect(getDocument(id).conflict).toContain("changed");
  });
  it("ignores stale disk checks that finish after a save", async () => {
    const id = createDocument({ ...file, saved: file.text });
    let finish!: (value: FileData) => void;
    mocked.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const checking = checkExternal(id);
    updateDocument(id, { revision: "r3", text: "new save", saved: "new save" });
    finish({ ...file, text: "old external", revision: "r2" });
    await checking;
    expect(getDocument(id).text).toBe("new save");
  });
});
