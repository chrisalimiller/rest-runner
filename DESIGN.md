---
name: REST Runner
description: A calm, dense desktop workbench for sending, testing and chaining REST requests, in a GitHub-dark default with a cool-slate "Mist" light twin.
colors:
  canvas: "#0d1117"
  surface: "#161b22"
  surface-inset: "#010409"
  surface-hover: "#1c2128"
  border: "#30363d"
  border-muted: "#21262d"
  border-strong: "#484f58"
  ink: "#e6edf3"
  ink-soft: "#c9d1d9"
  muted: "#8d96a0"
  faint: "#7d8590"
  accent: "#2f81f7"
  accent-fg: "#4493f8"
  send-green: "#238636"
  send-green-hover: "#2ea043"
  danger: "#f85149"
  danger-fill: "#da3633"
  ok: "#3fb950"
  warn: "#d29922"
  redirect: "#58a6ff"
  brand: "#bc8cff"
  brand-strong: "#8957e5"
  method-get: "#3fb950"
  method-post: "#d29922"
  method-put: "#58a6ff"
  method-patch: "#a371f7"
  method-delete: "#f85149"
  tab-underline: "#f78166"
  placeholder: "#ffa657"
  node-loop: "#db61a2"
  canvas-light: "#e9edf2"
  surface-light: "#f2f5f8"
  surface-inset-light: "#dde3ea"
  surface-hover-light: "#e0e6ed"
  border-light: "#c8d0da"
  border-muted-light: "#d7dde5"
  border-strong-light: "#a9b3c0"
  ink-light: "#18212b"
  ink-soft-light: "#2e3a47"
  muted-light: "#4a5666"
  faint-light: "#5a6674"
  accent-light: "#1f5fd0"
  send-green-light: "#1a7f37"
  danger-light: "#bf1f2a"
  ok-light: "#176a30"
  warn-light: "#7a5200"
  redirect-light: "#0b5cc4"
  brand-light: "#6f3fc9"
  brand-strong-light: "#5b2fb0"
  method-get-light: "#176a30"
  method-post-light: "#8a5a00"
  method-put-light: "#0b5cc4"
  method-patch-light: "#7240d0"
  method-delete-light: "#bf1f2a"
  tab-underline-light: "#c4451c"
  placeholder-light: "#9a4a00"
  node-loop-light: "#b0286f"
typography:
  display:
    fontFamily: "Red Hat Display Variable, Red Hat Display, Red Hat Text Variable, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.1
  title:
    fontFamily: "Red Hat Display Variable, Red Hat Display, Red Hat Text Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Red Hat Text Variable, Red Hat Text, -apple-system, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Red Hat Text Variable, Red Hat Text, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  send-button:
    backgroundColor: "{colors.send-green}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    height: "40px"
    width: "108px"
  send-button-hover:
    backgroundColor: "{colors.send-green-hover}"
  secondary-button:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  url-bar:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    height: "40px"
    padding: "5px"
  request-tab:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
    height: "28px"
  request-tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  tree-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "28px"
  tree-row-active:
    backgroundColor: "{colors.surface-hover}"
  chip:
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
  segmented:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    height: "26px"
  top-bar:
    backgroundColor: "{colors.surface-inset}"
    height: "52px"
    padding: "10px 20px"
  status-bar:
    backgroundColor: "{colors.surface-inset}"
    height: "40px"
  requests-sidebar:
    backgroundColor: "{colors.surface-inset}"
    width: "260px"
  flow-node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    width: "220px"
---

# Design System: REST Runner

This file records the system as shipped in `src/styles.css`, `src/layout.css` and `src/components/**/*.css`. The frontmatter holds the dark values (the default and the app's original look) plus `-light` keys for the Mist theme where a value differs. Only keys that are used appear. Shadows, motion and focus rings live in the sidecar `.impeccable/design.json`.

## Overview

**Creative North Star: "The Quiet Bench"** (a proposed name, not confirmed by the owner)

A workbench you sit at for hours: tools laid out within reach, nothing shouting. The surfaces are layered tonal greys with hairline borders, the type is small and even, and colour is spent only on meaning: HTTP method, response status, pass/fail, a single blue for focus and selection, and one green for Send. The default look is GitHub's Primer dark; the light theme ("Mist") is a deliberately cool slate rather than bright white (`#e9edf2` canvas).

Density is high and consistent. Body text is 13px, controls are 26 to 40px tall, rows are 28 to 32px. The request and response are flat panes on the canvas, divided by a single 1px line, and each opens with the same 60px band and 36px tab row so the lines between them run straight across the window. The darker inset ground marks the chrome around them (top bar, sidebar, status bar) and fields. Motion is short and functional: overlays fade or slide in 100 to 160ms with an exponential ease-out, and reduced-motion users get plain fades.

The brand purple appears in a few small, deliberate places (the mark, the active section on the status bar, pinned-tab ring, script/start/schedule markers) and is kept apart from the PATCH method purple.

**Key Characteristics:**
- Tonal layering plus 1px rings; shadows only on things that float over other content.
- Two themes from one token set; every component reads tokens, so a theme switch is only `data-theme` on `<html>`.
- Colour is semantic. Nothing is decorative except the brand mark.
- Pill shapes for state (chips, badges, segmented controls, status tiles use 12px); 6 to 8px for controls; 12px for panels and dialogs.
- Tabular numerals on counts and summaries.

## Colors

Cool grey ground, one blue, one green, and a status rainbow that always carries meaning. Both themes below are verified against the CSS; contrast ratios are computed from the hex values (WCAG relative luminance).

### Primary
- **Focus Blue** (dark `#2f81f7` fill, `#4493f8` as text/ring; light `#1f5fd0` for both): selection, focus ring, URL bar focus, links, the active-row inset stripe. `--accent-fg` is the readable text/ring form. Dark `#4493f8` is 6.1:1 on the canvas; light `#1f5fd0` is 4.95:1 on the canvas and 4.5:1 on inset.
- **Send Green** (dark `#238636`, hover `#2ea043`; light `#1a7f37`, hover `#166b2e`): the Send button only, with white text (4.63:1 dark, 5.08:1 light). The Cancel state turns it to Danger Fill.

### Secondary (brand)
- **Brand Purple** (dark `#bc8cff`; light `#6f3fc9`): the mark's braces, the hyphen in `rest-runner`, the active section indicator on the status bar, the pinned-tab active ring, and the Start/Schedule flow nodes. 7.5:1 dark, 5.5:1 light on canvas.
- **Brand Strong** (dark `#8957e5`; light `#5b2fb0`): solid fills and the script source-chip border.

### Neutral
- **Canvas** (dark `#0d1117`, light `#e9edf2`): body, panels, modals' base.
- **Surface** (dark `#161b22`, light `#f2f5f8`): sidebars, popovers, inputs, flow nodes, active tab; also `--bg-overlay`.
- **Inset** (dark `#010409`, light `#dde3ea`): the top bar, status bar, collections sidebar, URL bar and the response status field.
- **Hover** (dark `#1c2128`, light `#e0e6ed`): row hover and active row background.
- **Border / Muted border / Strong border** (dark `#30363d` / `#21262d` / `#484f58`; light `#c8d0da` / `#d7dde5` / `#a9b3c0`): control outlines, hairline dividers, hover outlines.
- **Ink** (dark `#e6edf3`, light `#18212b`): primary text, 16.0:1 and 13.8:1 on canvas. **Ink soft** (`#c9d1d9` / `#2e3a47`): secondary text in flows and summaries.
- **Muted** (dark `#8d96a0` 6.3:1; light `#4a5666` 6.35:1 on canvas, 5.77:1 on inset): labels, placeholders, inactive tabs.
- **Faint** (dark `#7d8590` 5.1:1; light `#5a6674` 4.98:1 on canvas, 4.53:1 on inset): separators, line numbers, folder icons.

### Status and method
- **OK** (`#3fb950` / `#176a30`), **Redirect** (`#58a6ff` / `#0b5cc4`), **Warn** (`#d29922` / `#7a5200`), **Bad/Danger** (`#f85149` / `#bf1f2a`; solid fill `#da3633` / `#bf1f2a`): status text, response tile tint, pass/fail, unsaved dot (warn), error boxes. Tints are `color-mix(... 10-15%, transparent)`, never separate swatches.
- **Methods**: GET `#3fb950` / `#176a30`; POST `#d29922` / `#8a5a00`; PUT `#58a6ff` / `#0b5cc4`; PATCH `#a371f7` / `#7240d0`; DELETE `#f85149` / `#bf1f2a`; HEAD, OPTIONS use Other (`#7d8590` / `#586575` (hard-coded, not tied to `--muted`)). All pass 4.5:1 on canvas, surface and inset in both themes (lowest: dark Other 4.64:1 on surface; light POST 4.59:1 on inset). Method text is 11px bold uppercase, with a 14% tinted pill in the URL bar.
- **Tab underline** (dark `#f78166`, light `#c4451c`): the one warm accent. It underlines the active tab in `.tabs` and the case tabs (2px, weight 600). It is not the focus colour.
- **Rainbow brackets** (`--rb-0` to `--rb-3`, then back to the first; `--rb-err` for a bracket with no partner): dark gold `#e3b341`, pink `#f778ba`, cyan `#56d4dd`, periwinkle `#a5a5ff`, error `#ff7b72` (8.1:1 or better on inset); light `#7d5000`, `#a62c74`, `#0a6c7a`, `#5340c8`, error `#bf1f2a` (4.7:1 or better on inset). They avoid the green, light blue and purple of the syntax tokens. Applied by `.rb-*` classes (`src/styles.css`) to brackets in the CodeMirror editors and in read-only `<pre>` views; the setting is **Rainbow brackets** in Settings.
- **Placeholder** (`#ffa657` on 12% tint / `#9a4a00` on 8% tint): `{{variable}}` marks in URLs and bodies; 9.8:1 dark, 5.3:1 light.
- **Node colours** (flows): Loop `#db61a2` / `#b0286f`; Note `#e3b341` / `#9a6700` with `--node-note-fg`; the rest reuse method and status tokens.
- **Request-tab group tones**: purple, blue, green, amber, pink and a neutral, each as a 12% background and a matching foreground. Red is left out on purpose because it means errors and Prod.

### Named Rules
**The Two Purples Rule.** Brand purple (`--brand` `#bc8cff`) and PATCH (`--patch` `#a371f7`) must stay visibly different and never swap roles. Brand marks identity and navigation; PATCH only labels the HTTP method and the If-branch in flows. (BRAND.md states the same rule.)

**The Meaning-Only Colour Rule.** Hue means something: method, status, brand, or the single blue for focus. A new colour needs a new meaning.

**The Mist Rule.** Light is cool slate, not white. Scrims and shadows in light are slate (`rgba(24,33,43,...)`), not black.

## Typography

**Display Font:** Red Hat Display Variable (falls back to Red Hat Text, then the sans stack)
**Body Font:** Red Hat Text Variable (falls back to -apple-system, Segoe UI, Noto Sans, Helvetica, Arial)
**Label/Mono Font:** JetBrains Mono Variable (falls back to ui-monospace, Menlo, Consolas)

**Character:** Humanist sans for chrome, a code face for anything that is data. Fonts are bundled from `src/assets/fonts`, so nothing is fetched at run time. Weights in use are 400 to 700, with 600 the usual emphasis.

### Hierarchy
- **Display** (600, 22px `--fs-display`, line-height 1.1): the first-run heading, and the status code in the response tile (set in mono).
- **Headline / xl** (18px `--fs-xl`): defined; used sparingly (for example the close glyph).
- **Title** (600, 15px `--fs-lg`): request name, modal headings (`h3`), quick-open input, status text (Red Hat Display).
- **Body** (400, 13px `--fs-md`, line-height 1.5): default text, menus, toasts.
- **Small** (12px `--fs-sm`): summaries, hints, secondary lines, segmented buttons.
- **Label** (600, 11px `--fs-xs`): section titles are uppercase with 0.04em to 0.6px tracking in muted; method labels are bold, uppercase, 0.04em; chips, counts, kbd and badges use 11px.
- **Code** (mono, 13px): URL field, key/value inputs, editors, status code, the status bar glyphs, the wordmark (600, 13px).

### Named Rules
**The Scale-Only Rule.** Font sizes come from `--fs-xs/sm/md/lg/xl/display` (11/12/13/15/18/22). No other pixel font sizes exist in the stylesheets.

**The Data Is Mono Rule.** URLs, status codes, timings, variable names, counts on the status bar and code are mono. Names and prose are Red Hat.

**The Tabular Numerals Rule.** Counts, tab badges, request summaries and tab groups use `font-feature-settings: "tnum" 1` so numbers do not jitter.

## Layout

A fixed app shell: top bar (52px), request-tab bar (44px) under it, the active section filling the rest, a status bar (40px) along the bottom with the section tabs, an activity slot and the Variables and Certificates buttons, and an optional side panel slot at the right (Variables, Certificates). Requests has a collapsible collections sidebar (260px, on the inset ground) at the left; Testing and Flows have their own nav columns (240px, `--nav-w`, collapsing to 40px). The inspector splits request and response at 55fr / 45fr with a 1px splitter line (7px hit area); each side has a 380px minimum. Both panes open with a 60px band (10px padding around a 40px field: the URL bar, or the response status field) and a 36px tab row with a 1px rule under it. When the Requests area is narrower than 1000px (a container query, so a side panel counts), the panes stack in two equal rows and the splitter becomes a horizontal line. Below a 1100px window the sidebar floats over the panes with a scrim. The Testing runbook is three columns (nav, steps, a 280px last-run column), dropping to two at 1200px and one at 800px. Flows is nav, canvas (with a 148px palette) and a 320px node-settings column.

Spacing is a 4px-based rhythm with common steps of 4, 6, 8, 10, 12, 16, 22 and 24px; the request and response bands use 10px 12px padding; the top bar uses 16px gaps. There is no spacing token set, so these are conventions, not variables.

Density: controls are 40px (Send, URL bar), 36px (action footer), 32px (top-bar fields, quick-open rows), 28px (tabs, tree rows, summary pills), 26px (segmented buttons, small pills), 22px (small segmented). Small controls get their hit area enlarged with `::after` pseudo-elements to at least 24 by 24 px (WCAG 2.5.8) without changing their visible size (tree toggle and menu, switcher pencil, small segmented, swatches, sidebar icon buttons).

The top bar degrades by priority, not by squeezing: first the request breadcrumb hides, then the wordmark, then the search shrinks to a magnifier and the request name ellipsizes (`useTopBarFit`). On macOS the top bar reserves 90px on the left for the traffic lights (20px in full screen).

## Elevation & Depth

Hybrid, but mostly tonal. Resting surfaces are flat: depth comes from three steps of grey (inset, canvas, surface) and 1px rings drawn as `box-shadow` or `inset box-shadow` (never a layout-shifting border). Real shadows are reserved for things that float over content, and they get heavier with height.

### Shadow Vocabulary
- **Selected row** (`inset 2px 0 0 var(--accent)`): active tree row, environment list, history and similar lists.
- **Flow node** (`0 1px 0 var(--shadow-xs)`; selected `0 0 0 1px var(--accent-fg)`; running `0 0 0 2px var(--accent-fg)` pulsing to 5px `--accent-subtle`).
- **Menu, toast, popover** (`0 8px 24px var(--shadow-md)`; the `.menu` uses `--shadow-lg`).
- **Details sheet** (`0 0 0 1px var(--border), 0 18px 40px var(--shadow-pop)`).
- **Dialog / switcher / quick open** (`0 0 0 1px var(--border), 0 16px 32px var(--shadow-lg)`).
- **Side sheet** (`-16px 0 32px var(--shadow-md)`).
- **Scrims**: modal `--scrim` (dark `rgba(1,4,9,0.7)`, light `rgba(24,33,43,0.4)`); sheets and quick open `--scrim-soft` (dark `rgb(0 0 0 / 35%)`, light `rgba(24,33,43,0.3)`).
- Shadow colours are tokens (`--shadow-xs/sm/md/pop/lg/ambient`) and change per theme.

### Named Rules
**The Float-Only Shadow Rule.** A drop shadow means the element overlays other content. Panels and rows get rings, not shadows.

**The Ring-Not-Border Rule.** Rings are `box-shadow`, so hover, focus and selection never change the box size.

## Shapes

One radius scale for the whole app (`--r-*`): **4px** `xs` for tiny inline marks (variable chips, kbd, swatches, bars); **6px** `sm` for compact controls (inputs, small buttons, rows, tabs, `.secondary`); **8px** `md` for standard buttons, cards, menus, toasts, flow nodes and code blocks; **12px** `lg` for dialogs, the URL bar, the response status field and the Send button; **pill** (999px) for chips, badges, counts, segmented controls inside panels and scrollbar thumbs. Circles (`50%`) are used directly for dots and spinners.

Segmented controls are 8px-radius with 6px buttons in the global style, and become pills in the request and response panes. Forms are inset (a darker field in a lighter row), with a 1px ring that turns blue on focus.

### Named Rules
**The Role-Radius Rule.** Pick the radius by role from the scale. Do not invent 3, 5, 10 or 14px.

## Components

Quiet and compact. Every interactive element has a hover, a keyboard focus ring and a disabled state (50% opacity, `cursor: default`).

### Top bar
- **Style:** 52px, inset background, 1px muted bottom border. Left to right: brand lockup (mark at least 20px tall, `rest-runner` in 13px mono with a purple hyphen), request switcher (32px field, surface background, name in 600 with a hidden-until-hover pencil, chevron), quick-open field (32px, canvas background, shortcut `kbd`), environment switch, overflow menu.
- **Behavior:** fit levels collapse parts in a fixed order (see Layout).

### Status bar
- **Style:** 40px high, inset background, 1px top border. The section tabs (icon 17px, label 13px) are muted until hovered (soft) or open (canvas ground, 600 ink, brand icon, a 3px brand line on the top edge). Between the tabs and the right-hand tools sit a 1px separator and the activity slot (accent text with a pulsing dot while work runs elsewhere, red after a failed run, faint "Nothing running" otherwise). Badges are 16px pills (mono 11px bold, 20% tint of the tone); dots are 7px. Below 1000px only the open tab keeps its label.

### Requests sidebar
- **Style:** 260px on the inset ground with a 1px right border. A 44px header (Collections / History small segmented control, ⋯ menu), a 30px filter field (canvas ground, 1px ring, accent ring on focus), the tree or history list, and a footer with + New request and From cURL…. Below a 1100px window it floats over the panes (shadow, 45% scrim).

### Response status band
- **Style:** a 60px band holding a 40px field built like the URL bar (inset ground, 1px ring, 12px radius, 5px padding). The status sits in a 30px pill tinted by the status where the URL bar has the method pill, followed by time, size and sent time in mono. The earlier-sends picker is a 30px pill at the right end (Latest ▾) that opens a listbox like the method list. Viewing an earlier send rings the field in amber and adds a tag.

### Collection tree
- **Style:** 28px rows, 6px radius, hover and active on `--bg-hover`, active also gets the 2px blue inset stripe. Method labels are 40px wide; folders have a muted chevron that rotates 90 degrees (100ms); counts are a muted pill; the row menu button (22px) appears on hover, focus or while open. Example rows are indented and muted until hovered or active.

### Request tabs
- **Style:** a 44px bar on the inset ground. Each tab is 28px high, 8px radius, 180px max, muted until hovered (surface) or active (surface, 1px ring, 600 ink). The close slot shows an amber dot when dirty and turns into × on hover or focus. Pinned tabs are 36 by 28 mono monograms with a muted ring, brand ring when active. Groups are labelled by a tinted pill and divided by a 1px rule; the strip scrolls with 24px edge fades.

### URL field and Send
- **Style:** a 40px inset bar with a 12px radius and 1px ring (blue on focus-within). Inside it, a method pill (92 by 30, 8px radius, 14% tint of the method colour) and a mono URL input. Send is 108 by 40, always the same width, 12px radius, Send Green with white text. While sending it turns to a transparent Danger-outlined Cancel. A guarded send (production environment) keeps the width and changes only its label.
- **Unfilled placeholders:** a warn-tinted pill with a dot and count at the right end of the field.

### Response tile and body
- **Style:** the status code (22px mono 600) and reason (15px Display 600) sit in an inline 12px-radius tile tinted 10% by status (ok, warn, bad, redirect); timing and size are `hero-meta` pills. The body is a soft code block (12px radius, inset background, 1px muted ring, 38px header strip). Empty and sending states sit in the same block; sending shows a 180 by 3px indeterminate bar.

### Chips and badges
- **Style:** pill, 11px, 1px border, 10% neutral fill. Variants: ok (green tint), bad (red tint), env (blue tint), source chips (script: brand; env: blue; unset: red). Earlier sends are listed in a dropdown, with a status-coloured dot for each.

### Segmented control
- **Style:** 2px padding, 1px ring, 26px buttons, muted text; the selected item gets the button background and 600 weight. Used for the Appearance setting (a `radiogroup`, arrow keys move and select) and for mode switches. In panels it is a pill; `.small` is 22px.

### Buttons
- **Secondary:** button background (dark `#21262d`, light `#e3e8ee`), 1px translucent border, 6px radius, weight 500; hover lifts to the hover button colour and the hover border. **Danger** secondary turns to a solid Danger Fill on hover. **Link buttons** use `--accent-fg`. **Icon buttons** are 6px radius. Colour transitions are 100ms.

### Modals, sheets, popovers, toasts
- **Modal:** surface background, 1px ring plus the dialog shadow, 12px radius, up to 860 by 560, header with a Display 15px title and a muted bottom border, over `--scrim`.
- **Side sheet:** up to 420px, right-aligned, left border and a leftward shadow, over `--scrim-soft`.
- **Popovers and menus:** surface, 8px radius (6px for `.menu`), 4px padding, items 6px radius.
- **Toasts:** bottom-left, 16px from the edges, 8px radius, undo link in blue.
- **Sidebar overlay and earlier-sends list:** the sidebar slides over the panes below a 1100px window; the earlier-sends list opens like the method list (no animation).

### Flow nodes
- **Style:** 220px wide, surface background, 1px border, 8px radius, 12px text. A kind row shows an 8px dot and an 11px uppercase label in the node colour. Passed and failed nodes get a 15% ok or bad wash; running nodes pulse a blue ring. Edges are muted by default, green when passed, red when failed, purple when the If is true, dashed grey when false, blue for parallel branches. The canvas uses React Flow with its colour variables mapped to app tokens, on dot-grid `--canvas-dot`.

## Do's and Don'ts

### Do:
- **Do** use the tokens in `src/styles.css`; add new values to both the dark `:root` and the Mist block, and to the `prefers-color-scheme: light` twin.
- **Do** use `--r-*` for every radius and `--fs-*` for every font size.
- **Do** draw state rings with `box-shadow` (`--focus-ring`, `--focus-ring-inset`).
- **Do** give every interactive element a visible keyboard focus state. The focus ring is a 2px `--accent-fg` ring.
- **Do** enlarge small controls to a 24 by 24 px hit area with an `::after` overlay.
- **Do** use `--dur-fast` (100ms) for exits and hover colour, `--dur-base` (160ms) for routine state change and enter, `--dur-slow` (280ms) at most, with `--ease-out` for enter and `--ease-in` for exit; animate only `transform` and `opacity` for overlays.
- **Do** provide a reduced-motion rule beside any new animation: stop transitions and pulses, slow spinners to 2.4s, keep colour feedback, and turn overlay motion into a 100ms linear fade.
- **Do** play exits for overlays with `useExitTransition` (a closing `data-state` on an inert copy) and use `Collapse` for small always-mounted content.
- **Do** keep the brand mark at least 20px tall and the runner `--text` coloured.
- **Do** use mono for data and tabular numerals for counts.

### Don't:
- **Don't** use `--brand` for HTTP PATCH, or `--patch` for brand elements.
- **Don't** use bright white in the light theme; it is Mist slate, and its shadows and scrims are slate, not black.
- **Don't** use bounce or elastic easing (the motion tokens forbid it).
- **Don't** put a shadow on a resting panel or row; use a ring.
- **Don't** use red for tab group labels; red means errors and Prod.
- **Don't** hard-code hex in components. The only literals outside the token blocks are the select caret SVG (`#7d8590`) and the native window background in `theme.ts`.
- **Don't** change a button's width when its label changes; Send stays 108px.
- **Don't** use `Collapse` for long lists; its children stay mounted.

### Known gaps (as shipped)
- **Light `--other` and `--syn-comment` still use the old `#586575`.** They are hard-coded and no longer match `--muted` (`#4a5666`). They read at 4.60:1 on the inset background.
- **Light muted/faint steps are small on inset.** `--faint` (`#5a6674`) is 4.53:1 on `#dde3ea`, and light accent on inset is 4.51:1; light POST on inset is 4.59:1. They pass AA with almost no margin.
- **The collection tree animates only small subtrees.** `TreeChildren` animates expand and collapse for up to 40 rows and skips reduced motion, repeated toggles and drags; larger subtrees open instantly. The chevron still rotates at a hard-coded 100ms. `Collapse` is used for the Variables, cURL and flow run panels.
- **Some motion is not on the tokens.** The chevron uses `0.1s`, the response body arrival `110ms ease-out`, and several loops (spinners 0.8s, pulse 1.2s, indeterminate 1.1s) use literals. The status tile and its code use `--dur-base` but `ease`, not `--ease-out`.
- **Two focus treatments exist.** `styles.css` paints `--focus-ring` as a 2px `box-shadow`; `layout.css` later sets `outline: 2px solid var(--accent-fg); outline-offset: 1px` for buttons, summaries, separators and file-label links. `layout.css` loads last, so on buttons both apply (a box-shadow ring and an outline with 1px offset, both blue 2px). Inputs, selects and textareas use only the box-shadow.
- **Legacy duplicate rules.** `styles.css` defines `.send`, `.modal`, `.chip`, `.secondary` and `.tabs` twice (an older GitHub-style block, then an overriding block). Edit the later block; the first is dead for most properties.
- **No spacing or shadow tokens for sizes.** Shadow colours are tokens, but offsets and blur values, and all spacing, are literals.
- **Dark `--accent` (`#2f81f7`) with white text is only 3.75:1** (`--accent-fg`, for text, is fine). Only `.primary-outline` and a few borders use `--accent` directly in dark; avoid putting white text on it.
- **Reduced motion keeps some motion.** By policy it is "fewer and gentler, not none": spinners still turn (2.4s), the indeterminate bar becomes a slow opacity pulse, and the status tile still fades in from 0.7 opacity.
