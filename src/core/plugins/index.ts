/**
 * Plugin module — public pure-core interface (INV-18).
 */

export {
  PLUGIN_CAPABILITIES,
  PLUGIN_HOOKS,
  type PluginCapability,
  type PluginHook,
  type PluginManifest,
  type ThemeManifest,
  type ValidationResult,
} from "./types.js";
export { validatePluginManifest, validateThemeManifest } from "./manifest.js";
