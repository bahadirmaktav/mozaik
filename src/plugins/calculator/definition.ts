import type { PluginDefinition } from "../contract";
import { createCalculator, disposeCalculator } from "./store";

export const calculatorPlugin: PluginDefinition = {
  id: "calculator",
  name: "Calculator",
  minimum: { width: 260, height: 360 },
  // Floating, it opens tall enough for Programmer's bases and all its key rows, and wide
  // enough for the History and Memory list beside the keys.
  float: { width: 640, height: 580 },
  create: createCalculator,
  loadView: () => import("./Calculator"),
  title: () => "Calculator",
  modified: () => false,
  // Its title never changes and it has nothing to save.
  subscribe: () => () => {},
  beforeClose: () => true,
  dispose: disposeCalculator,
};
