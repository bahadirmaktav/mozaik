import { afterEach, describe, expect, it } from "vitest";
import { drawingsBackend, type SaveRequest } from "../../services/drawings";
import { drawingFiles } from "../excalidraw/drawings";
import { diagramFiles, disposeDiagram, STARTER } from "./diagrams";

const original = { ...drawingsBackend };
afterEach(() => {
  diagramFiles.all().forEach((d) => disposeDiagram(d.id));
  drawingFiles.all().forEach((d) => drawingFiles.dispose(d.id));
  Object.assign(drawingsBackend, original);
});

describe("diagram store", () => {
  it("saves an untouched new diagram as its starter, as a Mermaid file", async () => {
    const requests: SaveRequest[] = [];
    drawingsBackend.save = async (request) => {
      requests.push(request);
      return {
        kind: "saved",
        file: {
          path: "C:/flow.mmd",
          name: "flow.mmd",
          text: request.text,
          revision: "r1",
          bom: false,
          ending: "lf",
        },
      };
    };
    const id = diagramFiles.create();
    expect(await diagramFiles.save(id)).toBe(true);
    expect(requests[0]).toMatchObject({
      kind: "mermaid",
      path: null,
      text: STARTER,
      name: "Untitled",
    });
    expect(diagramFiles.get(id).name).toBe("flow.mmd");
  });
  it("keeps names, paths and session lists apart from drawings", async () => {
    const kinds: string[] = [];
    drawingsBackend.takePending = async (kind = "excalidraw") => {
      kinds.push(kind);
      return [];
    };
    expect(diagramFiles.get(diagramFiles.create()).name).toBe("Untitled");
    expect(drawingFiles.get(drawingFiles.create()).name).toBe("Untitled");
    await diagramFiles.restoreSession();
    expect(kinds).toEqual(["mermaid"]);
    expect(diagramFiles.isPath("C:/a.MMD")).toBe(true);
    expect(diagramFiles.isPath("C:/a.mermaid")).toBe(true);
    expect(diagramFiles.isPath("C:/a.excalidraw")).toBe(false);
    expect(diagramFiles.baseName("flow.mmd")).toBe("flow");
  });
});
