import type React from "react";

/** Pericope's pilcrow-derived mark. currentColor keeps it theme-neutral. */
export function PericopeMark({ size = 16, title }: { size?: number; title?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 494 759"
      width={size * (494 / 759)}
      height={size}
      fill="currentColor"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M354 0 A 207.2 207.2 0 1 0 261 398.2 L261 759 L354 759 Z" />
      <rect x="421" width="73" height="759" />
    </svg>
  );
}
