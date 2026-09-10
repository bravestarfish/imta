"use client";

import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const ORDER: Theme[] = ["system", "light", "dark"];
const LABEL: Record<Theme, string> = { system: "Auto", light: "Light", dark: "Dark" };

/** Cycles system → light → dark. Stored in a cookie so the server renders the right theme without a flash. */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    document.cookie = `imta_theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  }, [theme]);
  const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
  return (
    <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setTheme(next)} title={`Theme: ${LABEL[theme]}. Click for ${LABEL[next]}.`} aria-label="Toggle colour theme">
      {theme === "dark" ? "☾" : theme === "light" ? "☀" : "◐"} {LABEL[theme]}
    </button>
  );
}
