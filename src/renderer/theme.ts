/**
 * Four appearances on two axes — temperature (warm ~85 / cool ~280) crossed
 * with luminance — and one material that sits over any of them.
 *
 * Glass and Candlelight used to be listed here as themes. They never were:
 * they change material only, and their geometry, type roles and semantic
 * colours were identical to Paper and Ink. Carrying them as separate themes
 * meant every colour decision had to be made six times instead of four, and
 * it put a material choice inside a list of atmospheres, where a reader had
 * to know that two of the six entries were secretly the same two as another
 * two. The material is now what it always was: a switch.
 */
export type AppTheme = "light" | "dark" | "porcelain" | "onyx";

/** Legacy ids kept only so stored settings can be migrated, never offered. */
export type LegacyAppTheme = "glass" | "dark-glass";

export type AppMaterial = "solid" | "translucent";

export interface ThemeOption {
  id: AppTheme;
  label: string;
  description: string;
  tone: "light" | "dark";
  temperature: "warm" | "cool";
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "light",
    label: "Paper",
    description: "Warm, quiet, and effortless to read.",
    tone: "light",
    temperature: "warm",
  },
  {
    id: "dark",
    label: "Ink",
    description: "Low-glare focus for long study.",
    tone: "dark",
    temperature: "warm",
  },
  {
    id: "porcelain",
    label: "Porcelain",
    description: "Cool true white. Crisp and bright.",
    tone: "light",
    temperature: "cool",
  },
  {
    id: "onyx",
    label: "Onyx",
    description: "Cool neutral black. Deep and calm.",
    tone: "dark",
    temperature: "cool",
  },
] as const;

export function isDarkTheme(theme: AppTheme): boolean {
  return theme === "dark" || theme === "onyx";
}

export function themeLabel(theme: AppTheme): string {
  return THEME_OPTIONS.find((option) => option.id === theme)?.label ?? "Paper";
}

/**
 * A reader who chose Glass chose Paper with the material on, and a reader who
 * chose Candlelight chose Ink with it on. Migrate rather than reset: silently
 * dropping someone back to a solid theme loses a preference they did express.
 */
export function migrateLegacyTheme(
  value: string,
): { theme: AppTheme; material: AppMaterial } | null {
  if (value === "glass") return { theme: "light", material: "translucent" };
  if (value === "dark-glass") return { theme: "dark", material: "translucent" };
  return null;
}
