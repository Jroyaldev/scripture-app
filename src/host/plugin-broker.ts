/**
 * Capability Broker — Node host layer.
 * Default-deny access surface for sandboxed plugins (M5).
 */

import type { PluginCapability, PluginManifest } from "../core/plugins/index.js";

export type ReferenceResource = {
  display: string;
  text: string;
};

export type DerivedWrite = {
  kind: "claim" | "overlay" | "sourceChunk" | "job";
  id: string;
  payload: Record<string, unknown>;
};

export type RenderedPanel = {
  id: string;
  title: string;
  location: "margin";
  html: string;
};

export type CapabilityDenial = {
  capability: string;
  reason: string;
  target?: string;
};

export type PluginBrokerState = {
  references?: Map<string, ReferenceResource>;
};

export type PluginApi = {
  references: {
    read(resourceId: string): Promise<ReferenceResource>;
  };
  derived: {
    write(record: DerivedWrite): Promise<void>;
  };
  ui: {
    panel(panel: { id: string; title: string; html: string }): Promise<void>;
  };
  network: {
    fetch(url: string): Promise<string>;
  };
};

export class CapabilityBroker {
  readonly manifest: PluginManifest;
  private references: Map<string, ReferenceResource>;
  private derivedWrites: DerivedWrite[] = [];
  private panels: RenderedPanel[] = [];
  private denials: CapabilityDenial[] = [];

  constructor(manifest: PluginManifest, state: PluginBrokerState = {}) {
    this.manifest = manifest;
    this.references = state.references ?? new Map();
  }

  createApi(): PluginApi {
    const api: PluginApi = {
      references: {
        read: async (resourceId) => this.readReference(resourceId),
      },
      derived: {
        write: async (record) => this.writeDerived(record),
      },
      ui: {
        panel: async (panel) => this.renderPanel(panel),
      },
      network: {
        fetch: async (url) => this.fetch(url),
      },
    };
    return deepFreeze(api);
  }

  getDerivedWrites(): DerivedWrite[] {
    return [...this.derivedWrites];
  }

  getPanels(): RenderedPanel[] {
    return [...this.panels];
  }

  getDenials(): CapabilityDenial[] {
    return [...this.denials];
  }

  getSubstrateWrites(): never[] {
    return [];
  }

  private async readReference(resourceId: string): Promise<ReferenceResource> {
    this.assertCapability("read:references", resourceId);
    const reference = this.references.get(resourceId);
    if (!reference) throw new Error(`Reference not found: ${resourceId}`);
    return reference;
  }

  private async writeDerived(record: DerivedWrite): Promise<void> {
    this.assertCapability("write:derived", record.id);
    this.derivedWrites.push({
      kind: record.kind,
      id: record.id,
      payload: { ...record.payload },
    });
  }

  private async renderPanel(panel: { id: string; title: string; html: string }): Promise<void> {
    this.assertCapability("ui:panel", panel.id);
    const declaredPanel = this.manifest.contributes?.panels?.find((contribution) => contribution.id === panel.id);
    if (!declaredPanel) {
      this.deny("ui:panel", `panel ${panel.id} not declared`, panel.id);
    }
    this.panels.push({
      id: panel.id,
      title: panel.title,
      location: declaredPanel?.location ?? "margin",
      html: panel.html,
    });
  }

  private async fetch(url: string): Promise<string> {
    this.assertCapability("network:fetch", url);
    const parsed = new URL(url);
    if (!this.isAllowedHost(parsed.hostname)) {
      this.deny("network:fetch", `host not allowed: ${parsed.hostname}`, url);
    }
    const response = await fetch(url);
    return await response.text();
  }

  private assertCapability(capability: PluginCapability, target?: string): void {
    if (!this.manifest.capabilities.includes(capability)) {
      this.deny(capability, `${capability} not declared`, target);
    }
  }

  private deny(capability: string, reason: string, target?: string): never {
    this.denials.push({ capability, reason, target });
    throw new Error(`Capability denied: ${reason}`);
  }

  private isAllowedHost(hostname: string): boolean {
    const allowedHosts = this.manifest.network?.allowedHosts ?? [];
    return allowedHosts.some((allowedHost) => {
      if (allowedHost.startsWith("*.")) {
        const suffix = allowedHost.slice(1);
        return hostname.endsWith(suffix);
      }
      return hostname === allowedHost;
    });
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
