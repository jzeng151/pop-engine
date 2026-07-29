import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("apps/web/app/globals.css"), "utf8");
const dashboardStyles = readFileSync(
  resolve("apps/web/app/events/[id]/dashboard/dashboard.css"),
  "utf8",
);
const darkTheme = styles.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1];

const colorFrom = (source: string, token: string): string => {
  const match = source.match(new RegExp(`--pe-${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (match?.[1] === undefined) throw new Error(`Missing color token --pe-${token}`);
  return match[1];
};

const color = (token: string): string => colorFrom(styles, token);

const darkColor = (token: string): string => {
  if (darkTheme === undefined) throw new Error("Missing dark theme tokens");
  return colorFrom(darkTheme, token);
};

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
};

const contrast = (foreground: string, background: string): number => {
  const high = Math.max(luminance(foreground), luminance(background));
  const low = Math.min(luminance(foreground), luminance(background));
  return (high + 0.05) / (low + 0.05);
};

describe("shared accessibility color contracts", () => {
  it("restores the original intake orange with accessible light-theme roles", () => {
    expect(color("coral")).toBe("#cc5500");
    expect(styles).toContain("--pe-amber: var(--pe-coral)");
    expect(contrast(color("action-edge"), color("coral"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color("action-edge"), color("accent-hover"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color("accent-text"), color("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color("brand-on"), color("brand-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(styles).not.toContain(".home a:not(.intake__submit)");
  });

  it("keeps light-surface focus and control boundaries above 3:1", () => {
    expect(contrast(color("coral"), color("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("control-rule"), color("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("control-rule"), color("card"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps Midnight Press text, controls, accents, and semantic colors accessible", () => {
    expect(contrast(darkColor("ink"), darkColor("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("steel"), darkColor("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("control-rule"), darkColor("card"))).toBeGreaterThanOrEqual(3);
    expect(contrast(darkColor("coral"), darkColor("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("accent-text"), darkColor("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("action-edge"), darkColor("coral"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("action-edge"), darkColor("coral-deep"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("brand-on"), darkColor("brand-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("blue"), darkColor("paper"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("on-info"), darkColor("blue"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("on-highlight"), darkColor("yellow"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkColor("on-clear"), darkColor("clear"))).toBeGreaterThanOrEqual(4.5);
  });

  it("uses intake orange as the landing, workspace, and dashboard accent", () => {
    expect(styles).toMatch(/\.riso-cover h1\s*\{\s*color: var\(--pe-accent\)/);
    expect(styles).toMatch(/\.riso-nav\s*\{[\s\S]*?background-color: var\(--pe-brand-surface\)/);
    expect(dashboardStyles).toMatch(
      /\.ops__gauge-percent\s*\{[\s\S]*?color: var\(--pe-accent-text\)/,
    );
  });

  it("uses an explicit theme attribute instead of the operating-system preference", () => {
    expect(styles).toContain('[data-theme="dark"]');
    expect(styles).not.toContain("@media (prefers-color-scheme: dark)");
  });

  it("places reduced-motion button overrides after the motion they disable", () => {
    const reducedMotion = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toContain(".button--primary:hover");
    expect(reducedMotion).toContain("transform: none");
  });
});
