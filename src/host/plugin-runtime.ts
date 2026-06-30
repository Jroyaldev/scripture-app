/**
 * Sandboxed plugin runtime — Node host layer.
 * Runs plugin source in a restricted VM context and exposes only broker APIs.
 */

import { Script, createContext } from "node:vm";
import { validatePluginManifest, type PluginManifest } from "../core/plugins/index.js";
import type { CapabilityBroker, CapabilityDenial, DerivedWrite, RenderedPanel } from "./plugin-broker.js";

export type PluginRuntimeResult = {
  returnValue: Record<string, unknown> | undefined;
  panels: RenderedPanel[];
  derivedWrites: DerivedWrite[];
  substrateWrites: never[];
  denials: CapabilityDenial[];
};

type PluginFunction = (api: unknown) => unknown | Promise<unknown>;

export class PluginRuntime {
  async run(manifest: PluginManifest, source: string, broker: CapabilityBroker): Promise<PluginRuntimeResult> {
    const validation = validatePluginManifest(manifest);
    if (!validation.ok) throw new Error(validation.error);
    if (!manifest.entry?.desktop) throw new Error("Executable plugins must declare entry.desktop");

    const moduleState: { exports: unknown } = { exports: undefined };
    const sandbox = {
      module: moduleState,
      exports: {},
    };
    const context = createContext(sandbox, {
      name: `plugin:${manifest.id}`,
      codeGeneration: { strings: false, wasm: false },
    });
    const script = new Script(`"use strict";\n${source}`, {
      filename: `${manifest.id}:${manifest.entry.desktop}`,
    });
    script.runInContext(context, { timeout: 1000 });

    if (!isPluginFunction(moduleState.exports)) {
      throw new Error("Plugin entry must assign module.exports to a function");
    }

    const returnValue = await moduleState.exports(broker.createApi());
    return {
      returnValue: isRecord(returnValue) ? returnValue : undefined,
      panels: broker.getPanels(),
      derivedWrites: broker.getDerivedWrites(),
      substrateWrites: broker.getSubstrateWrites(),
      denials: broker.getDenials(),
    };
  }
}

function isPluginFunction(value: unknown): value is PluginFunction {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
