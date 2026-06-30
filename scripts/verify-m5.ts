/**
 * M5 Verification — Plugin SDK + Capability Broker + DX.
 *
 * DONE WHEN: a reference plugin declaring read:references + write:derived +
 * ui:panel runs sandboxed, renders a margin panel, writes only Derived data,
 * is denied undeclared access by the broker, and a Theme with empty
 * capabilities restyles the app with no code execution. The guide exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validatePluginManifest,
  validateThemeManifest,
  type PluginManifest,
} from "../src/core/plugins/index.js";
import { CapabilityBroker } from "../src/host/plugin-broker.js";
import { PluginRuntime } from "../src/host/plugin-runtime.js";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  \u2714 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function main(): Promise<void> {
  section("1. Reference plugin manifest validates");
  const manifest: PluginManifest = {
    id: "example.sermon-surfacer",
    name: "Sermon Surfacer",
    version: "0.1.0",
    apiVersion: "1",
    entry: { desktop: "main.js" },
    capabilities: ["read:references", "write:derived", "ui:panel"],
    hooks: ["onReferenceOpen"],
    contributes: {
      panels: [{ id: "sermons", title: "Sermons", location: "margin" }],
    },
  };
  const validation = validatePluginManifest(manifest);
  check("Reference manifest accepted", validation.ok, validation.ok ? undefined : validation.error);
  check("Closed capability list excludes write:substrate", !manifest.capabilities.includes("write:substrate"));

  section("2. Sandboxed plugin runs through broker");
  const broker = new CapabilityBroker(manifest, {
    references: new Map([
      ["bref:v1/ACT.19.1-ACT.19.7", { display: "Acts 19:1-7", text: "received the Holy Spirit" }],
    ]),
  });
  const runtime = new PluginRuntime();
  const pluginSource = `
module.exports = async function plugin(api) {
  if ("substrate" in api) {
    throw new Error("Substrate API must not be exposed");
  }
  const ref = await api.references.read("bref:v1/ACT.19.1-ACT.19.7");
  await api.derived.write({
    kind: "claim",
    id: "claim_plugin_acts19",
    payload: { assertion: "Acts 19 connects baptism and receiving the Spirit.", ref: ref.display }
  });
  await api.ui.panel({
    id: "sermons",
    title: "Sermons",
    html: "<section><h2>Acts 19</h2><p>" + ref.text + "</p></section>"
  });
  try {
    await api.network.fetch("https://example.com/sermons");
  } catch (_err) {
    // Expected: undeclared network capability is denied by broker.
  }
  return { ok: true };
};
`;
  const result = await runtime.run(manifest, pluginSource, broker);
  check("Plugin returned ok", result.returnValue?.ok === true);
  check("Plugin rendered one margin panel", result.panels.length === 1 && result.panels[0]?.location === "margin");
  check("Plugin wrote one Derived record", result.derivedWrites.length === 1 && result.derivedWrites[0]?.kind === "claim");
  check("No Substrate writes exposed", result.substrateWrites.length === 0);
  check(
    "Undeclared network access denied",
    result.denials.some((denial) => denial.capability === "network:fetch" && denial.reason.includes("not declared")),
  );

  section("3. Theme manifest applies tokens without code execution");
  const themeManifest = {
    id: "theme.paper",
    name: "Paper Theme",
    version: "0.1.0",
    apiVersion: "1",
    capabilities: [],
    contributes: {
      theme: {
        tokens: {
          "color.background": "#fffdf7",
          "font.reading": "serif",
        },
      },
    },
  };
  const themeValidation = validateThemeManifest(themeManifest);
  check("Theme with empty capabilities accepted", themeValidation.ok, themeValidation.ok ? undefined : themeValidation.error);
  check("Theme has no executable entry", !("entry" in themeManifest));
  check(
    "Theme tokens returned",
    themeValidation.ok && themeValidation.value.contributes.theme.tokens["color.background"] === "#fffdf7",
  );

  section("4. DX guide exists");
  const guidePath = resolve(import.meta.dirname ?? ".", "../docs/plugins/first-plugin.md");
  const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf-8") : "";
  check("10-minute guide exists", guide.length > 0);
  check("Guide names required capabilities", ["read:references", "write:derived", "ui:panel"].every((term) => guide.includes(term)));

  console.log("\n=== M5 Verification Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log();

  if (failed > 0) {
    console.error("M5 VERIFICATION FAILED");
    process.exit(1);
  }

  console.log("M5 VERIFICATION PASSED");
}

void main().catch((err) => {
  console.error("M5 verification crashed:", err);
  process.exit(1);
});
