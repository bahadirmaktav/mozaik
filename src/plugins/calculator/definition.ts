import type { PluginDefinition } from "../contract";
import { createCalculator, disposeCalculator } from "./store";

export const calculatorPlugin: PluginDefinition = {
  id: "calculator",
  name: "Calculator",
  // However it is opened (tab, split or floating), it is never shorter than Programmer's
  // bases and all its key rows: the tab strip (36px) and about 470px of content.
  minimum: { width: 260, height: 510 },
  // Floating, it opens with room around the keys and the History and Memory list beside them.
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
