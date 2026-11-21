import { useSyncExternalStore } from "react";
import { newCalculator, perform, type Action, type Calculator } from "./model";

/**
 * The window's calculators by instance. Their state lives here, not in the view, so a hidden
 * tab keeps its expression, history and memory. Nothing is saved: closing the panel or the
 * window ends them (docs/decisions/035-calculator.md).
 */
interface Store {
  calculators: Map<string, Calculator>;
  listeners: Set<() => void>;
}
const store: Store = import.meta.hot?.data.calculatorStore ?? {
  calculators: new Map(),
  listeners: new Set(),
};
if (import.meta.hot) import.meta.hot.data.calculatorStore = store;
const { calculators, listeners } = store;

function emit() {
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function createCalculator() {
  const id = crypto.randomUUID();
  calculators.set(id, newCalculator());
  emit();
  return id;
}
export function disposeCalculator(id: string) {
  if (calculators.delete(id)) emit();
}
export function calculator(id: string) {
  let c = calculators.get(id);
  if (!c) {
    // A view of an instance this store has not seen (after a hot reload) starts empty.
    c = newCalculator();
    calculators.set(id, c);
  }
  return c;
}
export function act(id: string, ...actions: Action[]) {
  let c = calculator(id);
  for (const action of actions) c = perform(c, action);
  if (c === calculators.get(id)) return;
  calculators.set(id, c);
  emit();
}
export function useCalculator(id: string) {
  return useSyncExternalStore(subscribe, () => calculator(id));
}
