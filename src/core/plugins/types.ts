/**
 * Plugin manifest types — pure platform-agnostic TypeScript (INV-18).
 */

export const PLUGIN_CAPABILITIES = [
  "read:references",
  "read:notes",
  "read:sources",
  "read:derived",
  "write:derived",
  "network:fetch",
  "ai:invoke",
  "ui:panel",
  "ui:command",
  "schedule:background",
] as const;

export type PluginCapability = typeof PLUGIN_CAPABILITIES[number];

export const PLUGIN_HOOKS = [
  "onReferenceOpen",
  "onNoteSave",
  "onHighlightCreate",
  "onSourceImport",
  "onClaimExtracted",
  "onSchedule",
  "onCommand",
] as const;

export type PluginHook = typeof PLUGIN_HOOKS[number];

export type PluginPanelContribution = {
  id: string;
  title: string;
  location: "margin";
};

export type PluginCommandContribution = {
  id: string;
  title: string;
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  apiVersion: "1";
  entry?: { desktop: string };
  capabilities: PluginCapability[];
  network?: { allowedHosts: string[] };
  ai?: { declaredUse: string };
  hooks?: PluginHook[];
  contributes?: {
    panels?: PluginPanelContribution[];
    commands?: PluginCommandContribution[];
    theme?: {
      tokens: Record<string, string>;
    };
  };
};

export type ThemeManifest = Omit<PluginManifest, "entry" | "hooks" | "network" | "ai"> & {
  capabilities: [];
  contributes: {
    theme: {
      tokens: Record<string, string>;
    };
  };
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
