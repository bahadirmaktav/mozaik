import { describe, expect, it } from "vitest";
import { orderCommands, RECENT, type Command } from "./CommandPalette";

const command = (label: string): Command => ({
  id: label,
  label,
  run: () => {},
});

describe("command order", () => {
  it("lists the recently run commands first, then the rest alphabetically", () => {
    const commands = [
      "Save",
      "New Window",
      "Close Tab",
      "Add to Workspace…",
    ].map(command);
    const { list, recent } = orderCommands(commands, [
      "Save",
      "Gone",
      "Close Tab",
    ]);
    // A remembered command that is not offered now is skipped.
    expect(recent).toBe(2);
    expect(list.map((c) => c.label)).toEqual([
      "Save",
      "Close Tab",
      "Add to Workspace…",
      "New Window",
    ]);
  });
  it("puts the commands that match the query as one piece first", () => {
    const { list } = orderCommands(
      ["Tasks: New List…", "Tasks: New Task", "Add New Task Here"].map(command),
      [],
      "tasks: new task",
    );
    expect(list.map((c) => c.label)).toEqual([
      "Tasks: New Task",
      "Add New Task Here",
      "Tasks: New List…",
    ]);
  });
  it("keeps at most five recent commands", () => {
    const labels = ["A", "B", "C", "D", "E", "F", "G"];
    const { list, recent } = orderCommands(
      labels.map(command),
      [...labels].reverse(),
    );
    expect(recent).toBe(RECENT);
    expect(list.map((c) => c.label)).toEqual([
      "G",
      "F",
      "E",
      "D",
      "C",
      "A",
      "B",
    ]);
  });
});
