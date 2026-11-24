import type { ComponentType } from "react";
import type { Dock, Minimum } from "../../workspace/model";

export type ViewProps = {
  instanceId: string;
  focused: boolean;
  /** Docked tools only: whether the panel shows just its bar, and how to change that. */
  collapsed?: boolean;
  onCollapse?(collapsed: boolean): void;
};
export interface PluginDefinition {
  id: string;
  name: string;
  minimum: Minimum;
  create(): string;
  loadView(): Promise<{ default: ComponentType<ViewProps> }>;
  title(instanceId: string): string;
  modified(instanceId: string): boolean;
  // Notifies when titles or modified state may have changed.
  subscribe(listener: () => void): () => void;
  beforeClose(instanceId: string): boolean;
  /** A tab the user can name (a terminal); an empty name gives back the default title. */
  rename?(instanceId: string, name: string): void;
  /** Saves unsaved state when closing asks to; resolves true once it is saved. */
  save?(instanceId: string): Promise<boolean>;
  /** For a plugin with one panel application-wide: resolves false when another window
   * already shows it (that window is then focused). `create` returns a fixed ID. */
  claim?(): Promise<boolean>;
  /** Instances to open instead of a new one, such as the previous session's drawings. */
  restore?(): Promise<{ ids: string[]; errors: string[] }>;
  /** Lets automatic saves finish before `beforeClose` decides whether to ask. */
  settle?(instanceId: string): Promise<void>;
  /** `false` keeps it out of the launcher: it is only opened from another tool. */
  listed?: boolean;
  /** A docked tool: alone in its panel, without a tab strip (the view draws its own bar),
   * collapsible to that bar. */
  dock?: Dock;
  dispose(instanceId: string): void;
}
