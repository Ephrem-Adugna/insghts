"use client";

import { useEffect, useState } from "react";

const STORAGE = "insight-theme";

export function applyTheme(theme: string) {
  const root = document.documentElement;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  root.classList.toggle("dark", resolved === "dark");
}

export function ThemeToggle({ initial = "system" }: { initial?: string }) {
  const [theme, setTheme] = useState(initial);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE) ?? initial;
    setTheme(stored);
    applyTheme(stored);
  }, [initial]);

  function cycle() {
    const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    setTheme(next);
    localStorage.setItem(STORAGE, next);
    applyTheme(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      className="mono text-[11px] uppercase tracking-[0.12em] text-[var(--fg-faint)] hover:text-[var(--fg)]"
      title="Cycle light, dark, and system"
    >
      {theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"}
    </button>
  );
}

export function ThemeScript() {
  const code = `
    (function(){
      try {
        var t = localStorage.getItem('${STORAGE}') || 'system';
        var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
