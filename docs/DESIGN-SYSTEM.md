# PopEngine Design System

**STATUS:** APPROVED (2026-07-25; see `docs/BASELINE.md`)
**AMENDMENT:** Amended 2026-08-02 for the Riso Field Guide visual foundation, which replaced the Warm & Authentic foundation in the 2026-07-29 UI work. Until this amendment, this document still described Warm & Authentic while `apps/web/app/globals.css` had been rebuilt to Riso, and a second, unregistered design document at `apps/web/DESIGN.md` described what actually shipped. Two active design artifacts for one concern is what governance §4 forbids, so the Riso content is folded in here and that file is removed. No visual decision is reopened; this is the approved artifact catching up with the code.
**AUTHORITATIVE FOR:** visual foundations, tokens, type, color, spacing, and shared component treatment. Approved feature specs remain authoritative for feature behavior, regulatory/safety copy, and required UI states.

**Governance gate (unchanged):** This is a baseline design-system amendment, not a roadmap F-id. Visual tokens and shared CSS land only while this document remains `APPROVED` in `docs/BASELINE.md`. Do not invent a product F-id for theme work; feature behavior still requires an approved `specs/F-xxx-*.md`. Scope stays presentation only — tokens, type, color, spacing, and existing-route chrome. It must not add endpoints, tables, regulatory copy, feature acceptance criteria, or new cross-feature navigation / workflow shortcuts.

That gate is not widened here. The 2026-07-29 work also added a cross-stage navigation shell, an overview route, and a theme control, which the clause above excludes. Those are product scope and now belong to `specs/F-705-event-workspace-shell.md`. What this document describes of them is how they look; what they do, and which states they must reach, is F-705's.

This document describes the CSS foundation in `apps/web/app/globals.css`. It adds no CSS framework. Display, body, and mono faces are self-hosted through `next/font/google` in `apps/web/app/layout.tsx` (no runtime request to fonts.googleapis.com).

---

## 1. Core Vision

**Creative north star: "Riso Field Guide."** PopEngine reads as a practical printed manual assembled for work in the field. Intake orange, federal blue, registration yellow, paper grain, condensed type, hard rules, and deliberately offset ink marks make an ownable visual world without costing the clarity an operational tool owes its user.

The system follows one event through Ideate, Comply, Market, and Operate. Its expression can be tactile and assertive, but the product stays source-conscious: verdicts, ruleset snapshots, citations, unknowns, conflicts, and research states keep their hierarchy and never dissolve into decoration. Planned capabilities look provisional and stay disabled.

- Printed field-manual materiality, not generic dashboard chrome.
- An intake-orange lifecycle rail anchoring a warm paper work area.
- Signal colors assigned to operational meaning, never to ambient decoration.
- Condensed headlines, highly legible body copy, mono provenance.
- Hard registration offsets, square rules, restrained misregistration.
- One responsive system for desktop planning and phone-based field work.

---

## 2. Color

The palette combines the intake form's original burnt-orange selection accent, workwear-blue information states, and warm, legible paper neutrals.

**Primary.** _Intake Orange_ `#cc5500`, the original selected-option color, owns the organizer rail, product mark, landing headline, primary action, and active operational emphasis. _Intake Orange Text_ `#a34400` carries small orange text on paper, where the brighter original would miss the normal-text contrast floor. _Intake Orange Hover_ `#e26713` keeps dark control text accessible while clearly shifting the pressed plate.

**Secondary.** _Federal Blue_ marks source-backed information, citations, feasible verdicts, and regulatory structure. It is not a general decorative accent. _Federal Blue Deep_ supplies the darker informational state.

**Tertiary.** _Registration Yellow_ marks focus on dark surfaces, the current route, and at-risk verdicts; intake orange supplies the accessible focus rule on light paper. _Field Green_ is reserved for cleared or trustworthy status.

**Neutral.** Paper (main canvas), Deep Paper (hover and surface separation), Ink (body text, hard borders, structural offset shadows), Steel (secondary copy and quiet metadata), Rule (subordinate dividers), Control Rule (input, radio, and checkbox boundaries that must stay visible against paper), Surface (input and metadata-banner fill), Card (regulatory units and task surfaces needing a discrete container), Cream Text (copy on dark federal blue and green semantic surfaces), Accent Ink (near-black copy on the intake-orange action surface, so normal text meets WCAG AA without darkening the orange).

**Midnight Press (dark).** A composed charcoal-stock palette, not an inversion. Canvas, surface, and card progress through `#111316`, `#181c22`, `#20262e`; warm text `#f4eee1`, muted text `#b9b3a7`, control rules `#737068`. Intake orange lifts to `#ff8a3d`, with `#ff9a5c` for readable small foreground emphasis; orange-filled actions use midnight ink. The lifecycle rail uses the deeper `#a34400` with warm text. Federal blue lifts to `#82a7ff` and stays reserved for information; cleared states lift to `#6bc98a`.

Light is the default on a first visit regardless of the operating-system preference, and the root `data-theme` attribute remaps semantic tokens. The control that switches them is F-705's.

**The Signal Color Rule.** Intake orange marks action or blocked conditions; registration yellow marks focus, current position, or at-risk state. Never interchange them for decoration.

**The Paper Is a Surface Rule.** Texture may make the canvas tactile. It never carries meaning and never reduces text contrast.

---

## 3. Typography

**Display:** Barlow Condensed (Arial Narrow, sans-serif fallbacks). **Body:** Public Sans (Segoe UI, system-ui). **Label/mono:** IBM Plex Mono (ui-monospace, Menlo).

The condensed display face supplies a field guide's urgency and economy. Public Sans keeps instructions comfortable under pressure. IBM Plex Mono identifies provenance, status, version metadata, and stamps as operational evidence.

| Role         | Treatment                                                    | Usage                                                           |
| :----------- | :----------------------------------------------------------- | :-------------------------------------------------------------- |
| **Display**  | 800, responsive oversized scale, 0.83 line-height            | Product marks, cover titles, organizer overview                 |
| **Headline** | 800, responsive page scale, 1.08 line-height                 | Functional page titles                                          |
| **Title**    | 800, 2rem, 1 line-height                                     | Lifecycle chapters, workbench headings                          |
| **Body**     | 400–700, 1rem base, 1.55 line-height; reading lines 42–48rem | Instructions, findings, interactive copy                        |
| **Label**    | 600, 0.68rem, 0.12em tracking, uppercase                     | Provenance, statuses, navigation chapters, stamps, compact meta |

**The Three-Voice Rule.** Barlow Condensed carries marks, headlines, and chapters; Public Sans carries sentences and controls; IBM Plex Mono carries evidence and status.

**The Useful Label Rule.** Small uppercase mono type must identify real metadata or state. It is never an ornamental eyebrow.

---

## 4. Layout

Organizer routes use a lifecycle shell. Below 64rem, navigation is a native disclosure above the work area; at 64rem and wider a 17rem sticky rail sits beside the paper workspace and scrolls independently. The first viewport always establishes the active event and current task.

Content is constrained by task: 34rem for attendee and door-day flows, 48rem for general forms and marketing, 52rem for plans and checklists, widening to 38rem, 52rem, and 56rem on large screens. Responsive grids begin at 40rem, shell gutters expand at 48rem, the desktop rail arrives at 64rem. The base vertical stack is 1.15rem; distinct regulatory or interactive units use 1.1rem by 1.25rem internal padding.

**The One-Event Rail Rule.** The lifecycle rail orients every organizer task around the same event; attendee and authentication surfaces stay outside it.

---

## 5. Elevation and Shape

Flat by default, using hard registration offsets rather than atmospheric elevation. A four-pixel offset establishes a clickable or discrete printed unit; pressed and hover states reduce it to two. Paper, rule weight, ink misregistration, and sparse tonal fills carry the rest of the hierarchy.

- **Ink Registration** `4px 4px 0 var(--pe-ink)` — primary actions, verdict bands, strong active states.
- **Orange Plate Offset** `4px 4px 0 var(--pe-accent-soft)` — quieter paper cards.
- **Pressed Registration** `2px 2px 0 var(--pe-ink)` with a two-pixel translation on hover.
- **Ink Plate Offset** `3px 3px 0 var(--pe-ink)` — selected field-guide and planned-module moments.

The form language is nearly square: controls and containers use the field radius, while navigation, stamps, and tab rules stay square. Borders are visible 1.5–2px ink rules; major section boundaries may reach 3px. The planned-module paper is the one irregular silhouette, using a subtle clipped edge and sub-degree rotation to signal unfinished scope without suggesting interactivity.

**The Registration, Not Elevation Rule.** Shadows are short, hard printing offsets. No generic soft card shadows in this shell.

**The One Torn Edge Rule.** Irregular clipping and rotation are for clearly planned material. Functional regulatory content stays rectilinear and scannable.

---

## 6. Components

Components behave like durable printed tools: high contrast, visible state, little ornament, roughly 44px minimum interactive height.

**Buttons.** Nearly square field corners, 2px ink border. Primary is intake orange with accent ink in light and midnight ink in Midnight Press, bold Public Sans, compact horizontal padding, hard ink registration offset. Hover moves to the theme's brighter orange and presses the offset inward; focus uses intake orange on paper and registration yellow on dark. Secondary uses paper or card fill with an ink rule, shifting to deep paper and an orange border on hover. Disabled keeps its label readable, drops opacity, and shows the prohibited cursor.

**Cards and containers.** Nearly square corners; card or translucent surface over the paper texture; orange plate offsets for standard units and ink offsets for strong interactive ones; 1.5–2px ink or semantic rule; card spacing token, denser only for compact metadata.

**Inputs and fields.** Surface fill, accessible control rule, nearly square corners, mono text for entered regulatory data where already established. Focus adds an orange border plus a visible external treatment, the global focus token switching between intake orange on paper and registration yellow on dark. Error text and border use the distinct semantic red; disabled controls keep their label and are never hidden.

**Navigation (visual treatment; behavior is F-705).** The intake-orange lifecycle rail groups links under Ideate, Comply, Market, and Operate. Each target has an inline riso icon and a 44px minimum hit area. Live destinations sit on explicit paper-slip surfaces with ink text; light-theme links exceed 7:1 contrast, and the solid rail avoids texture-dependent contrast variance. Hover lifts to clean paper; the active route switches to registration yellow with ink text and a hard offset.

**Theme control (visual treatment; behavior is F-705).** Light is visually quiet; dark uses the intake-orange active treatment with dark ink. Its visible copy identifies the current theme.

**Planned modules (visual treatment; behavior is F-705).** A clipped paper insert over the orange rail, visibly stamped `PLANNED`, communicating roadmap breadth without implying the capability works.

**Permit plan workbench.** Live regulatory content stays in the review column, paired with a scoped checklist companion at desktop widths. Intake orange owns the page title, tabs, route ladder, and workbench framing. Federal blue appears only where it carries semantic information: the source snapshot and a feasible verdict. Other engine-derived verdict bands use registration yellow or intake orange by actual verdict. Ruleset snapshots, citations, verification states, unknowns, conflicts, research requirements, and coverage gaps stay visible with their source-backed copy.

**Provenance snapshot.** Ruleset version and publication date sit in a compact IBM Plex Mono banner with a federal-blue rule and shallow blue plate offset. Values come from stored or live plan metadata, never from presentation copy.

---

## 7. Do and Don't

**Do** keep intake orange dominant in wayfinding and action while reserving federal blue for source-backed information and feasible regulatory states. **Do** pair every regulatory decision with its engine-provided provenance and uncertainty state. **Do** use the paper texture as a low-contrast material layer. **Do** preserve visible focus, 44px targets, responsive stacking, and reduced-motion behavior. **Do** label synthetic data and planned capabilities wherever they could be mistaken for real or shipped behavior.

**Don't** turn the shell into a generic rounded-card dashboard or add soft ambient elevation. **Don't** use tiny mono labels as decorative eyebrows or let them become unreadable. **Don't** invent regulatory copy, ruleset versions, statuses, metrics, or feature availability for visual effect. **Don't** hide unknowns, official conflicts, research-required states, coverage gaps, or partial plans. **Don't** apply torn-paper silhouettes to active regulatory content.
