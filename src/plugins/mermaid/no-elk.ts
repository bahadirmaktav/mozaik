// Mermaid's ELK layout uses elkjs, which is EPL-2.0 and cannot be distributed with GPL-3.0
// code. Vite resolves elkjs to this module, so a diagram asking for `layout: elk` shows this
// message; render.ts makes dagre the default layout instead.
export default class ELK {
  layout(): Promise<never> {
    return Promise.reject(
      new Error(
        "The ELK layout is not included in Mozaik. Remove `layout: elk` to use the default layout.",
      ),
    );
  }
}
