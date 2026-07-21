export type AppTheme = "light" | "dark" | "glass" | "dark-glass" | "porcelain" | "onyx";

export interface ThemeOption {
  id: AppTheme;
  label: string;
  description: string;
  tone: "light" | "dark";
  material: "solid" | "glass";
}

/**
 * All reading atmospheres share geometry and interaction semantics.
 * Only light, depth, and material change between them.
 */
export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "porcelain",
    label: "Porcelain",
    description: "Brand white with a gold mark. Crisp and bright.",
    tone: "light",
    material: "solid",
  },
  {
    id: "light",
    label: "Paper",
    description: "Warm, quiet, and effortless to read.",
    tone: "light",
    material: "solid",
  },
  {
    id: "dark",
    label: "Ink",
    description: "Low-glare focus for long study.",
    tone: "dark",
    material: "solid",
  },
  {
    id: "onyx",
    label: "Onyx",
    description: "Brand ink with a gold ember. Deep and calm.",
    tone: "dark",
    material: "solid",
  },
  {
    id: "glass",
    label: "Glass",
    description: "Soft daylight with translucent depth.",
    tone: "light",
    material: "glass",
  },
  {
    id: "dark-glass",
    label: "Candlelight",
    description: "Warm dark glass with a gentle glow.",
    tone: "dark",
    material: "glass",
  },
] as const;

export function isDarkTheme(theme: AppTheme): boolean {
  return theme === "dark" || theme === "dark-glass" || theme === "onyx";
}

export function themeLabel(theme: AppTheme): string {
  return THEME_OPTIONS.find((option) => option.id === theme)?.label ?? "Paper";
}
