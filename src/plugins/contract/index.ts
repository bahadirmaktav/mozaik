import type { ComponentType } from "react";
import type { Minimum } from "../../workspace/model";

export type ViewProps = { instanceId: string; focused: boolean };
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
  /** Saves unsaved state when closing asks to; resolves true once it is saved. */
  save?(instanceId: string): Promise<boolean>;
  /** For a plugin with one panel application-wide: resolves false when another window
   * already shows it (that window is then focused). `create` returns a fixed ID. */
  claim?(): Promise<boolean>;
  dispose(instanceId: string): void;
}
