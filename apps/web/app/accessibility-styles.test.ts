import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("apps/web/app/globals.css"), "utf8");

const color = (token: string): string => {
  const match = styles.match(new RegExp(`--pe-${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (match?.[1] === undefined) throw new Error(`Missing color token --pe-${token}`);
  return match[1];
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
  it("keeps primary-action text at AA contrast in normal and hover states", () => {
    expect(contrast(color("cream-text"), color("coral"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color("cream-text"), color("blue"))).toBeGreaterThanOrEqual(4.5);
    expect(styles).not.toContain(".home a:not(.intake__submit)");
  });

  it("keeps light-surface focus and control boundaries above 3:1", () => {
    expect(contrast(color("blue"), color("paper"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("control-rule"), color("surface"))).toBeGreaterThanOrEqual(3);
    expect(contrast(color("control-rule"), color("card"))).toBeGreaterThanOrEqual(3);
  });

  it("places reduced-motion button overrides after the motion they disable", () => {
    const reducedMotion = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toContain(".button--primary:hover");
    expect(reducedMotion).toContain("transform: none");
  });
});
