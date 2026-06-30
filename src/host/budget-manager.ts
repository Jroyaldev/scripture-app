/**
 * Budget Manager — Node host layer.
 * Enforces the Budget Envelope (§4.10, INV-16).
 * Tracks daily token/spend usage and clamps AI/network activity.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BudgetEnvelope } from "../core/interfaces.js";

const DEFAULT_ENVELOPE: BudgetEnvelope = {
  backgroundAI: "off",
  networkBackground: false,
};

export class BudgetManager {
  private envelope: BudgetEnvelope;
  private configPath: string;
  private todayTokens = 0;
  private todaySpendUsd = 0;
  private currentDate: string;

  constructor(configDir: string) {
    this.configPath = join(configDir, "budget-envelope.json");
    this.envelope = this.load();
    this.currentDate = new Date().toISOString().slice(0, 10);
  }

  private load(): BudgetEnvelope {
    if (!existsSync(this.configPath)) return { ...DEFAULT_ENVELOPE };
    try {
      return JSON.parse(readFileSync(this.configPath, "utf-8")) as BudgetEnvelope;
    } catch {
      return { ...DEFAULT_ENVELOPE };
    }
  }

  save(): void {
    const dir = join(this.configPath, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(this.envelope, null, 2));
  }

  get(): BudgetEnvelope {
    return { ...this.envelope };
  }

  update(envelope: BudgetEnvelope): void {
    this.envelope = { ...envelope };
    this.save();
  }

  canSpend(tokens: number): boolean {
    if (this.envelope.backgroundAI === "off") return false;
    this.resetDailyIfNeeded();
    if (this.envelope.dailyTokenCeiling !== undefined) {
      if (this.todayTokens + tokens > this.envelope.dailyTokenCeiling) return false;
    }
    return true;
  }

  recordSpend(tokens: number, costUsd = 0): void {
    this.resetDailyIfNeeded();
    this.todayTokens += tokens;
    this.todaySpendUsd += costUsd;
  }

  isNetworkAllowed(): boolean {
    return this.envelope.networkBackground;
  }

  isAIAllowed(): boolean {
    return this.envelope.backgroundAI !== "off";
  }

  getUsage(): { date: string; tokensUsed: number; spendUsd: number } {
    this.resetDailyIfNeeded();
    return {
      date: this.currentDate,
      tokensUsed: this.todayTokens,
      spendUsd: this.todaySpendUsd,
    };
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.todayTokens = 0;
      this.todaySpendUsd = 0;
    }
  }
}
