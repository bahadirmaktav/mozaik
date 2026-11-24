import type { PluginDefinition } from "../contract";
import { createCalculator, disposeCalculator } from "./store";

export const calculatorPlugin: PluginDefinition = {
  id: "calculator",
  name: "Calculator",
  minimum: { width: 260, height: 360 },
  create: createCalculator,
  loadView: () => import("./Calculator"),
  title: () => "Calculator",
  modified: () => false,
  // Its title never changes and it has nothing to save.
  subscribe: () => () => {},
  beforeClose: () => true,
  dispose: disposeCalculator,
};
