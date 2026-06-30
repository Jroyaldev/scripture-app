/**
 * Plugin manifest validation — pure platform-agnostic TypeScript (INV-18).
 */

import {
  PLUGIN_CAPABILITIES,
  PLUGIN_HOOKS,
  type PluginCapability,
  type PluginCommandContribution,
  type PluginHook,
  type PluginManifest,
  type PluginPanelContribution,
  type ThemeManifest,
  type ValidationResult,
} from "./types.js";

const CAPABILITY_SET = new Set<string>(PLUGIN_CAPABILITIES);
const HOOK_SET = new Set<string>(PLUGIN_HOOKS);

export function validatePluginManifest(input: unknown): ValidationResult<PluginManifest> {
  if (!isRecord(input)) return { ok: false, error: "Manifest must be an object" };
  const base = validateBase(input);
  if (!base.ok) return base;

  const capabilitiesResult = readCapabilities(input["capabilities"]);
  if (!capabilitiesResult.ok) return capabilitiesResult;
  const capabilities = capabilitiesResult.value;
  if (capabilities.includes("network:fetch") && !hasAllowedHosts(input["network"])) {
    return { ok: false, error: "network:fetch requires network.allowedHosts" };
  }
  if (capabilities.includes("ai:invoke") && !hasDeclaredAiUse(input["ai"])) {
    return { ok: false, error: "ai:invoke requires ai.declaredUse" };
  }

  const hooksResult = readHooks(input["hooks"]);
  if (!hooksResult.ok) return hooksResult;
  const entry = readEntry(input["entry"]);
  if (!entry.ok) return entry;

  return {
    ok: true,
    value: {
      id: base.value.id,
      name: base.value.name,
      version: base.value.version,
      apiVersion: "1",
      entry: entry.value,
      capabilities,
      network: readNetwork(input["network"]),
      ai: readAi(input["ai"]),
      hooks: hooksResult.value,
      contributes: readContributes(input["contributes"]),
    },
  };
}

export function validateThemeManifest(input: unknown): ValidationResult<ThemeManifest> {
  const plugin = validatePluginManifest(input);
  if (!plugin.ok) return plugin;
  if (plugin.value.entry) {
    return { ok: false, error: "Theme manifests must not declare entry" };
  }
  if (plugin.value.capabilities.length !== 0) {
    return { ok: false, error: "Theme capabilities must be empty" };
  }
  const tokens = plugin.value.contributes?.theme?.tokens;
  if (!tokens) {
    return { ok: false, error: "Theme manifests must contribute tokens" };
  }
  return {
    ok: true,
    value: {
      id: plugin.value.id,
      name: plugin.value.name,
      version: plugin.value.version,
      apiVersion: "1",
      capabilities: [],
      contributes: { theme: { tokens } },
    },
  };
}

function validateBase(input: Record<string, unknown>): ValidationResult<{
  id: string;
  name: string;
  version: string;
}> {
  const id = input["id"];
  const name = input["name"];
  const version = input["version"];
  const apiVersion = input["apiVersion"];
  if (typeof id !== "string" || id.trim() === "") return { ok: false, error: "id is required" };
  if (typeof name !== "string" || name.trim() === "") return { ok: false, error: "name is required" };
  if (typeof version !== "string" || version.trim() === "") return { ok: false, error: "version is required" };
  if (apiVersion !== "1") return { ok: false, error: "apiVersion must be 1" };
  return { ok: true, value: { id, name, version } };
}

function readCapabilities(value: unknown): ValidationResult<PluginCapability[]> {
  if (!Array.isArray(value)) return { ok: false, error: "capabilities must be an array" };
  const capabilities: PluginCapability[] = [];
  for (const capability of value) {
    if (typeof capability !== "string" || !CAPABILITY_SET.has(capability)) {
      return { ok: false, error: `Unknown capability: ${String(capability)}` };
    }
    if (capability === "write:substrate") {
      return { ok: false, error: "write:substrate is not a capability" };
    }
    capabilities.push(capability as PluginCapability);
  }
  return { ok: true, value: [...new Set(capabilities)] };
}

function readHooks(value: unknown): ValidationResult<PluginHook[] | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value)) return { ok: false, error: "hooks must be an array" };
  const hooks: PluginHook[] = [];
  for (const hook of value) {
    if (typeof hook !== "string" || !HOOK_SET.has(hook)) {
      return { ok: false, error: `Unknown hook: ${String(hook)}` };
    }
    hooks.push(hook as PluginHook);
  }
  return { ok: true, value: [...new Set(hooks)] };
}

function readEntry(value: unknown): ValidationResult<{ desktop: string } | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value) || typeof value["desktop"] !== "string" || value["desktop"].trim() === "") {
    return { ok: false, error: "entry.desktop must be a string" };
  }
  return { ok: true, value: { desktop: value["desktop"] } };
}

function hasAllowedHosts(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value["allowedHosts"]) && value["allowedHosts"].every((host) => typeof host === "string");
}

function hasDeclaredAiUse(value: unknown): boolean {
  return isRecord(value) && typeof value["declaredUse"] === "string" && value["declaredUse"].trim() !== "";
}

function readNetwork(value: unknown): { allowedHosts: string[] } | undefined {
  if (!isRecord(value)) return undefined;
  const allowedHosts = value["allowedHosts"];
  if (!Array.isArray(allowedHosts) || !allowedHosts.every((host) => typeof host === "string")) {
    return undefined;
  }
  return { allowedHosts };
}

function readAi(value: unknown): { declaredUse: string } | undefined {
  if (!isRecord(value)) return undefined;
  const declaredUse = value["declaredUse"];
  if (typeof declaredUse !== "string" || declaredUse.trim() === "") return undefined;
  return { declaredUse };
}

function readContributes(value: unknown): PluginManifest["contributes"] {
  if (!isRecord(value)) return undefined;
  return {
    panels: readPanels(value["panels"]),
    commands: readCommands(value["commands"]),
    theme: readTheme(value["theme"]),
  };
}

function readPanels(value: unknown): PluginPanelContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(isRecord)
    .filter((panel) => typeof panel["id"] === "string" && typeof panel["title"] === "string" && panel["location"] === "margin")
    .map((panel) => ({ id: panel["id"] as string, title: panel["title"] as string, location: "margin" as const }));
}

function readCommands(value: unknown): PluginCommandContribution[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter(isRecord)
    .filter((command) => typeof command["id"] === "string" && typeof command["title"] === "string")
    .map((command) => ({ id: command["id"] as string, title: command["title"] as string }));
}

function readTheme(value: unknown): { tokens: Record<string, string> } | undefined {
  if (!isRecord(value) || !isRecord(value["tokens"])) return undefined;
  const tokens: Record<string, string> = {};
  for (const [key, tokenValue] of Object.entries(value["tokens"])) {
    if (typeof tokenValue === "string") tokens[key] = tokenValue;
  }
  return { tokens };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
