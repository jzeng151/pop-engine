"use client";

import { useEffect, useState } from "react";

export const THEME_STORAGE_KEY = "popengine-theme";

type Theme = "light" | "dark";

const storedTheme = (): Theme => {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const applyTheme = (theme: Theme): void => {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initialTheme = storedTheme();
    applyTheme(initialTheme);
    setTheme(initialTheme);

    const synchronizeTheme = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextTheme = event.newValue === "dark" ? "dark" : "light";
      applyTheme(nextTheme);
      setTheme(nextTheme);
    };

    window.addEventListener("storage", synchronizeTheme);
    return () => window.removeEventListener("storage", synchronizeTheme);
  }, []);

  const dark = theme === "dark";

  const toggleTheme = () => {
    const nextTheme: Theme = dark ? "light" : "dark";
    applyTheme(nextTheme);
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for this page when storage is unavailable.
    }
  };

  return (
    <button
      aria-label={`Switch to ${dark ? "light" : "dark"} theme`}
      aria-pressed={dark}
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
    >
      <svg aria-hidden="true" className="theme-toggle__icon" viewBox="0 0 24 24">
        {dark ? (
          <path d="M19 15.2A8 8 0 0 1 8.8 5a8.2 8.2 0 1 0 10.2 10.2Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
          </>
        )}
      </svg>
      <span>Theme</span>
      <strong>{dark ? "Dark" : "Light"}</strong>
    </button>
  );
}
