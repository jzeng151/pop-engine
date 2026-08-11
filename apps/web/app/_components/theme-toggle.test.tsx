// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY, ThemeToggle } from "./theme-toggle";

beforeEach(() => {
  const values = new Map<string, string>();
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  document.documentElement.dataset.theme = "light";
  document.documentElement.style.colorScheme = "light";
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ThemeToggle", () => {
  it("starts in light mode when no preference has been saved", async () => {
    render(<ThemeToggle />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeDefined();
    expect(screen.getByText("Light")).toBeDefined();
  });

  it("switches themes and persists the selection", async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Switch to light theme" })).toBeDefined();
    expect(screen.getByText("Dark")).toBeDefined();
  });

  it("restores a saved dark preference and synchronizes changes from another tab", async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeToggle />);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("dark");
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: THEME_STORAGE_KEY,
          newValue: "light",
        }),
      );
    });

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe("light");
    });
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeDefined();
  });
});
