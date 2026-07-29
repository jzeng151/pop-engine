---
name: PopEngine Riso Field Guide
description: A printed field-manual interface for moving one NYC event from idea to event day with regulatory provenance attached.
colors:
  federal-blue: "#163f8c"
  federal-blue-deep: "#0d2d6e"
  signal-coral: "#b72f2b"
  registration-yellow: "#f1c735"
  field-green: "#23683d"
  paper: "#f3efe3"
  paper-deep: "#e5ddcb"
  ink: "#171815"
  steel: "#5d5b52"
  rule: "#ada898"
  control-rule: "#858077"
  surface: "#faf7ee"
  card: "#f8f4e9"
  cream-text: "#fffdf6"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(3.5rem, 10vw, 7.5rem)"
    fontWeight: 800
    lineHeight: 0.83
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(2.2rem, 5.2vw, 3.1rem)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "normal"
  body:
    fontFamily: "Public Sans, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.68rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.12em"
rounded:
  square: "0"
  field: "0.15rem"
spacing:
  stack: "1.15rem"
  card-block: "1.1rem"
  card-inline: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.signal-coral}"
    textColor: "{colors.cream-text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0.68rem 1rem"
    height: "2.8rem"
  button-primary-hover:
    backgroundColor: "{colors.federal-blue}"
    textColor: "{colors.cream-text}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0.68rem 1rem"
    height: "2.8rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "0.7rem 0.8rem"
    height: "2.85rem"
  navigation-active:
    backgroundColor: "{colors.registration-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0.48rem 0.62rem"
    height: "2.75rem"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "1.1rem 1.25rem"
  verdict-at-risk:
    backgroundColor: "{colors.registration-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.85rem 1rem"
  verdict-infeasible:
    backgroundColor: "{colors.signal-coral}"
    textColor: "{colors.cream-text}"
    rounded: "{rounded.field}"
    padding: "0.85rem 1rem"
---

# Design System: PopEngine Riso Field Guide

## Overview

**Creative North Star: "Riso Field Guide"**

PopEngine feels like a practical printed manual assembled for work in the field. Federal blue,
signal coral, registration yellow, real paper grain, condensed type, hard rules, and deliberately
offset ink marks create an ownable visual world without compromising the clarity expected of an
operational tool.

The system follows one event through Ideate, Comply, Market, and Operate. Its expression can be
tactile and assertive, but the product remains source-conscious: verdicts, ruleset snapshots,
citations, unknowns, conflicts, and research states keep their hierarchy and never disappear into
decoration. Planned capabilities look intentionally provisional and remain disabled.

**Key Characteristics:**

- Printed field-manual materiality rather than generic dashboard chrome.
- A federal-blue lifecycle rail anchoring a warm paper work area.
- Signal colors assigned to operational meaning, not ambient decoration.
- Condensed headlines paired with highly legible body copy and mono provenance.
- Hard registration offsets, square rules, and restrained misregistration details.
- One responsive system for desktop planning and phone-based field work.

## Colors

The palette combines workwear blue and printing-press signal inks with warm, legible paper
neutrals.

### Primary

- **Federal Blue:** Owns the organizer rail, links, feasible verdicts, and major structural rules.
- **Federal Blue Deep:** Supplies the darker blue state when the primary needs greater depth.

### Secondary

- **Signal Coral:** Marks the primary action, infeasible verdicts, conflicts, and riso registration
  offsets.

### Tertiary

- **Registration Yellow:** Marks focus on dark surfaces, the current route, at-risk verdicts, and
  small field-guide labels. Federal blue supplies the accessible focus rule on paper surfaces.
- **Field Green:** Reserved for cleared or trustworthy status, never as a general accent.

### Neutral

- **Paper:** The main canvas behind organizer and marketing surfaces.
- **Deep Paper:** A shallow tonal layer for hover and surface separation.
- **Ink:** Body text, hard borders, and structural offset shadows.
- **Steel:** Secondary copy and quiet metadata.
- **Rule:** Subordinate dividers and non-interactive strokes.
- **Control Rule:** Input, radio, and checkbox boundaries that must remain visible against paper.
- **Surface:** Input and metadata-banner fill.
- **Card:** Regulatory units and task surfaces that need a discrete container.
- **Cream Text:** High-contrast copy placed on federal blue or signal coral.

### Named Rules

**The Signal Color Rule.** Coral marks action or blocked conditions; yellow marks focus, current
position, or at-risk state. Do not interchange them for decoration.

**The Paper Is a Surface Rule.** Texture may make the canvas tactile, but it never carries meaning
or reduces text contrast.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow and sans-serif fallbacks)

**Body Font:** Public Sans (with Segoe UI and system-ui fallbacks)

**Label/Mono Font:** IBM Plex Mono (with ui-monospace and Menlo fallbacks)

**Character:** The condensed display face supplies the urgency and economy of a field guide.
Public Sans keeps instructions comfortable under pressure, while IBM Plex Mono identifies
provenance, status, version metadata, and stamps as operational evidence.

### Hierarchy

- **Display** (800, responsive oversized scale, 0.83 line-height): Product marks, cover titles, and
  the organizer overview.
- **Headline** (800, responsive page scale, 1.08 line-height): Functional page titles.
- **Title** (800, 2rem, 1 line-height): Lifecycle chapters and workbench headings.
- **Body** (400–700, 1rem base, 1.55 line-height): Instructions, findings, and interactive copy;
  long reading lines stay close to 42–48rem.
- **Label** (600, 0.68rem, 0.12em letter-spacing, uppercase): Provenance, statuses, navigation
  chapters, field-guide stamps, and compact metadata.

### Named Rules

**The Three-Voice Rule.** Barlow Condensed carries marks, headlines, and chapters; Public Sans
carries sentences and controls; IBM Plex Mono carries evidence and status.

**The Useful Label Rule.** Small uppercase mono type must identify real metadata or state, never
serve as ornamental eyebrow copy.

## Layout

Organizer routes use a lifecycle shell. Below 64rem, navigation is a native disclosure above the
work area; at 64rem and wider, a 17rem sticky rail sits beside the paper workspace and scrolls
independently. The first viewport always establishes the active event and current task.

Content is constrained by task: 34rem for attendee and door-day flows, 48rem for general forms and
marketing, and 52rem for plans and checklists. Those measures widen to 38rem, 52rem, and 56rem on
large screens. Responsive grids begin at 40rem, shell gutters expand at 48rem, and the desktop rail
arrives at 64rem. The base vertical stack is 1.15rem; distinct regulatory or interactive units use
1.1rem by 1.25rem internal padding.

**The One-Event Rail Rule.** The lifecycle rail orients every organizer task around the same event;
attendee and authentication surfaces remain outside it.

## Elevation & Depth

This system is flat by default and uses hard registration offsets instead of atmospheric
elevation. A four-pixel offset establishes a clickable or discrete printed unit; pressed or hover
states reduce that offset to two pixels. Paper, rule weight, ink misregistration, and sparse tonal
fills create the rest of the hierarchy.

### Shadow Vocabulary

- **Ink Registration:** `4px 4px 0 var(--pe-ink)` for primary actions, verdict bands, and strong
  active states.
- **Blue Plate Offset:** `4px 4px 0 rgba(22, 63, 140, 0.14)` for quieter paper cards.
- **Pressed Registration:** `2px 2px 0 var(--pe-ink)` paired with a two-pixel translation on hover.
- **Coral Plate Offset:** `3px 3px 0 var(--pe-coral)` for selected field-guide and planned-module
  moments.

### Named Rules

**The Registration, Not Elevation Rule.** Shadows are short, hard printing offsets. Do not introduce
generic soft card shadows into the Riso Field Guide shell.

## Shapes

The form language is nearly square. Controls and containers use the field radius, while navigation,
stamps, and tab rules remain square. Borders are visible 1.5–2px ink rules; major section boundaries
may reach 3px. The planned-module paper is the one irregular silhouette, using a subtle clipped edge
and sub-degree rotation to signal unfinished scope without suggesting interactivity.

**The One Torn Edge Rule.** Reserve irregular clipping and rotation for clearly planned material;
functional regulatory content stays rectilinear and easy to scan.

## Components

Components behave like durable printed tools: high contrast, visible state, little ornament, and a
minimum interactive height of roughly 44px.

### Buttons

- **Shape:** Nearly square field corners with a 2px ink border.
- **Primary:** Signal coral with cream text, bold Public Sans, compact horizontal padding, and a hard
  ink registration offset.
- **Hover / Focus:** Hover changes to federal blue and presses the registration offset inward. Focus
  uses federal blue on paper and registration yellow on the federal-blue rail.
- **Secondary:** Paper or card fill with an ink rule; hover shifts to deep paper and coral border.
- **Disabled:** The label remains readable, opacity drops, and the prohibited cursor makes the state
  explicit.

### Cards / Containers

- **Corner Style:** Nearly square field corners.
- **Background:** Card or translucent surface over the paper texture.
- **Shadow Strategy:** Blue plate offsets for standard units; ink offsets for strong interactive
  units.
- **Border:** 1.5–2px ink or semantic-color rule.
- **Internal Padding:** The card spacing token, with denser values only for compact metadata.

### Inputs / Fields

- **Style:** Surface fill, accessible control rule, nearly square corners, and mono text for entered
  regulatory data where already established.
- **Focus:** Coral border plus a visible external focus treatment; the global focus token switches
  between federal blue on paper and registration yellow on dark surfaces.
- **Error / Disabled:** Error text and border use signal coral; disabled controls preserve their
  label and are never hidden.

### Navigation

The federal-blue lifecycle rail groups links under Ideate, Comply, Market, and Operate. Each target
has an inline riso icon and a 44px minimum hit area. Hover uses a light paper wash; the active route
switches to registration yellow with ink text and a hard offset. Mobile uses a native `details`
disclosure, while desktop keeps the rail persistent.

### Planned Modules

Planned modules appear on a clipped paper insert over the blue rail. Every item is a disabled native
button and the group is visibly stamped `PLANNED`; the treatment communicates roadmap breadth
without implying the capability works.

### Permit Plan Workbench

The plan keeps its live regulatory content in the review column and pairs it with a scoped checklist
companion at desktop widths. Engine-derived verdict bands use federal blue, registration yellow, or
signal coral by actual verdict. Ruleset snapshots, citations, verification states, unknowns,
conflicts, research requirements, and coverage gaps remain visible and retain their source-backed
copy.

### Provenance Snapshot

Ruleset version and publication date sit in a compact IBM Plex Mono banner with a federal-blue rule
and a shallow blue plate offset. Values come from stored or live plan metadata, never from
presentation copy.

## Do's and Don'ts

### Do:

- **Do** keep federal blue dominant in the organizer shell and reserve signal inks for their assigned
  operational roles.
- **Do** pair every regulatory decision with its engine-provided provenance and uncertainty state.
- **Do** use the real paper texture as a low-contrast material layer.
- **Do** preserve visible focus, 44px targets, responsive stacking, and reduced-motion behavior.
- **Do** label synthetic data and planned capabilities wherever they could be mistaken for real or
  shipped behavior.

### Don't:

- **Don't** turn the shell into a generic rounded-card dashboard or add soft ambient elevation.
- **Don't** use tiny mono labels as decorative eyebrows or allow them to become unreadable.
- **Don't** invent regulatory copy, ruleset versions, statuses, metrics, or feature availability for
  visual effect.
- **Don't** hide unknowns, official conflicts, research-required states, coverage gaps, or partial
  plans.
- **Don't** apply torn-paper silhouettes to active regulatory content.
