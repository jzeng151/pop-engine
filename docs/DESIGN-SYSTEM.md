# PopEngine Design System

**STATUS:** APPROVED (2026-07-25; see `docs/BASELINE.md`)
**AMENDMENT:** Amended 2026-07-29 for the Warm & Authentic visual foundation (this PR).
**AUTHORITATIVE FOR:** visual foundations and intake-card design language. Approved feature specs remain authoritative for feature behavior, regulatory/safety copy, and required UI states.

This document describes the Warm & Authentic CSS foundation in `apps/web/app/globals.css`. It does not add a CSS framework or require additional font packages.

---

## 1. Core Vision & Design Philosophy

* **Tone:** Warm, clear, grounded, and trustworthy.
* **Core Design Principles:**
  * **Cream canvas:** A soft paper field provides depth without reducing contrast or clarity.
  * **Grounded cards:** Near-white cards and sand rules group related content with restrained shadows.
  * **Clear hierarchy:** Display type is reserved for page titles; body copy and metadata remain legible at compact sizes.
  * **Status is visible:** Orange directs primary action, green identifies cleared states, and rose identifies errors.

---

## 2. Color Palette & Utility System

### Base Surface & Text
* **Canvas:** `#fffdd0` (`--pe-paper`) with `#f3e6c4` (`--pe-paper-deep`) for depth.
* **Card surfaces:** `#fffef5` (`--pe-surface`) and `#fffef8` (`--pe-card`).
* **Ink:** `#3d2314` (`--pe-ink`) for headings and high-emphasis content.
* **Muted text:** `#7a5c45` (`--pe-steel`) for supporting copy and metadata.
* **Rules and borders:** `#d2b48c` (`--pe-rule`).

### Actions and Status
* **Primary action / focus:** Burnt orange `#b34a00` (`--pe-amber`) — chosen for ≥4.5:1 contrast with cream action labels.
* **Clear state / primary hover:** Forest green `#1c7a1c` (`--pe-clear`) — same contrast floor with cream labels.
* **Error state:** Rose `#9b2d1f` (`--pe-rose`).
* **Supporting warm accent:** Saddle brown `#8b4513` (`--pe-neon`).

---

## 3. Typography Hierarchy

* **Display:** `Fraunces`, Georgia, serif (`--pe-font-display`) for page titles.
* **Body:** `Nunito Sans`, system sans-serif (`--pe-font-body`) for labels, controls, and prose.
* **Metadata:** `IBM Plex Mono`, system monospace (`--pe-font-mono`) for eyebrow labels, counters, and compact status details.

| Role | CSS foundation | Usage |
| :--- | :--- | :--- |
| **Eyebrow** | `--pe-font-mono`, uppercase, tracked, muted steel | Route context and compact metadata |
| **Main header** | `--pe-font-display`, ink, responsive display scale | Page title |
| **Field label** | `--pe-font-body`, uppercase, ink | Form field label |
| **Body** | `--pe-font-body`, ink or muted steel | Supporting copy and input values |

---

## 4. UI Component Specifications

### 1. Cards and fields
Cards use near-white surfaces, sand borders, modest radius, and restrained warm shadows. Inputs use the metadata face where compact structured data benefits from alignment. Hover and focus states use the burnt-orange accent with a visible focus outline.

### 2. Primary and secondary actions
Primary actions use burnt orange with cream text; their hover state shifts to forest green. Secondary actions retain the card surface and use the sand rule. Both states preserve a visible keyboard focus treatment.

### 3. Eyebrows and metadata
The shared `.pe-eyebrow` uses IBM Plex Mono, uppercase tracking, muted steel text, and a small forest-green mark. It provides context without competing with the display heading.
