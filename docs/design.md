# Kairos Tester design system

A calm, dense work tool. The person using it is in the middle of testing; every screen
should answer "what needs me now?" and get out of the way. References: Linear (fixed
sidebar, inbox, keyboard), GitHub Primer (status icons, tables), TestRail (run → results).

## Principles

1. **The loop comes first.** Run tests → answer what needs you → see results → report.
   The sidebar is in that order. The Needs you count is visible on every page and in the
   browser tab title, and can raise a desktop notification.
2. **One next step.** Pages that can be a starting point (Results, empty states) lead with
   one sentence and one button for the most useful next action.
3. **Nothing is dropped.** Anything the AI hands to a person can be handed back
   ("Done, let the AI check it"); the AI revisits it and confirms the result.
4. **Show the work.** The run page shows the application live beside the results, and every
   AI result carries what it expected, what it saw, its checks and screenshots.
5. **Progressive disclosure.** Rare options sit behind "More filters", "Add a note",
   collapsed panels and Setup, not on the main path.

## Tokens (`src/app/globals.css`)

| Token | Use |
|---|---|
| `ink-*` | Text and primary buttons (near-black, slightly warm) |
| `accent-*` (cobalt) | Links, focus rings, current selection. Never a result. |
| `slate-*` (neutral, re-defined) | Borders, secondary text, surfaces |
| green / red / amber | **Only** Pass / Fail / Blocked |
| `font-sans` | Segoe UI (native on Windows laptops), system fallbacks |
| `font-mono` | Case IDs (`.case-id`), keys (`.kbd`), commands |

Base size 14px, tabular numbers everywhere. Controls are 32px high (`.btn-*`, `.input`).
Radii: 6px controls, 8px panels, full only for dots and counts.

## Status

Each result has its own **shape** (`src/components/icons.tsx`), so it reads without colour:

| Result | Icon | Colour |
|---|---|---|
| Pass | check | green-700 |
| Fail | cross | red-700 |
| Blocked | circle with slash | amber-700 |
| Not run | dashed circle | slate-500 |
| N/A | dash | slate-500 |

Priority uses signal bars in ink, never the result colours, so "High priority" never
looks like "Failed".

The `StatusBar` meter (pass/fail/blocked fill, not-run track) uses `#3aa15f / #a51d1d /
#e0a43a`, checked with the dataviz palette validator: CVD separation ΔE 15.5 (deutan),
normal-vision ΔE 32. Blocked is below 3:1 contrast on white, so the bar always ships with
its labelled legend and the per-section table.

## Components (`src/components/ui.tsx`)

`PageHeader` (title, subtitle, one primary action, optional back link) · `NextStep` ·
`StatusBar` · `StatStrip` (one bordered strip instead of a row of identical cards) ·
`OutcomeBadge` / `OutcomeIcon` · `PriorityBadge` · `CountPill` · `Alert` · `EmptyState`
(an invitation with one action, not an error) · `Card`.

## Things this UI does not do

These are the common marks of generated, generic interfaces, removed on purpose:

- No gradients, glows or drop shadows on cards (only floating menus and dialogs).
- No uppercase, letter-spaced eyebrow labels; labels are sentence case.
- No emoji or text glyphs as icons; one stroke icon set.
- No rows of identical stat cards; numbers live in one strip or one bar.
- No thick coloured border on one side of a card.
- No pulsing "live" decoration unless something is actually running (the run indicator and
  the live view only animate while frames are arriving).
- No more than one primary (ink) button per area.

## Keyboard

In Needs you, the top result listens for <kbd>P</kbd> Pass, <kbd>F</kbd> Fail,
<kbd>B</kbd> Blocked, <kbd>N</kbd> N/A (not while typing in a field). After a decision the
next card moves up and takes over the keys.
