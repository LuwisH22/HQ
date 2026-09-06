# LFHQ Visual Design System V2 — "Blackout"

Phase 4.5 · Visual direction only · Source of truth for the next implementation stage.

This document replaces the Nocturne tokens in `src/index.css` as the visual reference. It changes
how LFHQ looks. It does not change what LFHQ does. Every screen, component and state described
here already exists in the product or is part of the shipped voice architecture.

---

## 0. Executive summary

- **Direction chosen:** A — *Blackout* (minimal premium esports), tempered by the typographic
  discipline of Direction B and the monospace metadata of Direction C.
- **Base:** true near-black, violet-tinted neutrals. The cat's black is the brand. The sidebar is
  the darkest plane in the app.
- **Accent:** *Ultraviolet*, used as light rather than paint. Two working tones: a saturated fill
  for primary actions and a pale glow tone for text, icons, blades and rings. A restrained *Brass*
  secondary marks rank and ownership.
- **Type:** Archivo (display, variable width) for titles, stats and eyebrows. Geist Sans for all UI
  and chat. Geist Mono for timestamps, handles, emails and hints.
- **Shape:** hairline edges, small radii (2 / 4 / 6 / 10 / 16), tile avatars, a 2 px accent
  "blade" for selection, and a 1 px "edge-light" on elevated surfaces. No chamfers, no glass.
- **Depth:** tonal steps plus hairlines. Shadow only on overlays. Glow only on focus, speaking,
  primary hover and the loading bar.
- **Motion:** 80–220 ms, one easing family, no bounce, one looping animation on screen at most.
- **Mascot:** boot loading, sign-in, empty states, errors, first-run. Nowhere else.
- **Development language removed from production UI:** no "SOON", no "Phase N".

---

## 1. Three visual directions

### Direction A — Blackout (minimal premium esports)

Near-black violet-tinted neutrals, a single ultraviolet accent treated as light, brass for rank.
Typography carries hierarchy; boxes are hairlines, not panels. The mascot's world (black body,
lavender-white glow) is the product's world.

- Brand identity: strong, and continuous with the existing mascot and wordmark.
- Usability: excellent; the accent is reserved for state, so state is always legible.
- Readability: excellent; highest text contrast of the three on the darkest ground.
- Esports feel: premium-org rather than gamer. Reads like a team's own tooling.
- Long-session comfort: best of the three. Lowest overall luminance, no warm/cool fighting.
- Scalability: strong. Accent-as-light scales to new modules without repainting.
- Risk: violet is a crowded colour in gaming. Mitigated by the black base, pale-glow usage, brass
  and the typographic system. Distinctiveness comes from the system, not the hue.

### Direction B — Broadcast (dark editorial / performance)

Warm charcoal ground (#141312), near-white type, condensed display numerals, editorial rules and
ticker-style metadata. Accent: *Volt* lime (#D4F04A). Feels like a match broadcast lower-third.

- Brand identity: very distinctive; strongest "performance" signal.
- Usability: good, but lime is hard to use for small selected states without looking cheap.
- Readability: good; warm charcoal is comfortable, but lime text fails contrast at 13 px.
- Esports feel: strongest and most literal. Also the most dated in three years.
- Long-session comfort: warm ground is comfortable; lime highlights fatigue.
- Scalability: medium; the editorial scale needs a lot of typographic care per screen.
- Risk: drifts toward a sports media site, and away from an internal tool.

### Direction C — Tactical (modern tactical HQ)

Steel-blue-black ground (#0B1017), ice/teal accent (#5EEAD4), monospace metadata everywhere, tick
marks, corner brackets, grid backgrounds. Ops-room.

- Brand identity: distinctive, but close to crypto dashboards and cyberpunk game sites.
- Usability: good; teal state is legible.
- Readability: monospace at density costs reading speed in chat.
- Esports feel: tactical, not organisational. Feels like a shooter HUD.
- Long-session comfort: cold blue ground is the least comfortable for hours.
- Scalability: brittle. Brackets and tick marks are ornament, and ornament does not scale.
- Risk: the exact look the brief excludes.

### Recommendation

**Direction A, with two borrowed disciplines.**

1. From B: display numerals and a real typographic scale. Hierarchy comes from type, not from
   card borders.
2. From C: monospace for metadata only. Timestamps, emails, handles, IDs, keyboard hints and
   percentages are set in Geist Mono. Nothing else is.

The mascot glow is a **light**, and the mascot animation has not been produced yet. The Higgsfield
brief should specify the glow in the V2 accent tones (§2) so artwork and UI share one light source.

---

## 2. Final colour palette

Dark-only. LFHQ V2 does not ship a light theme; the `:root` light block stays only so variables
resolve. All hex values are final.

### 2.1 Core tokens

| Token | Hex | Use |
| --- | --- | --- |
| `bg/canvas` | `#0C0C12` | App background, content area, input wells |
| `bg/sidebar` | `#07070A` | Sidebar and mobile tab bar. The darkest plane |
| `surface` | `#14141C` | Cards, panels, message hover, composer, right panel |
| `surface/elevated` | `#1A1A24` | Voice bar, secondary buttons, chips, hover on surface |
| `surface/hover` | `#1F1F2A` | Hover on canvas and surface rows |
| `surface/active` | `#1B1930` | Selected nav, selected row, mention chips (accent tint) |
| `surface/overlay` | `#1C1C27` | Popovers, dropdowns, dialogs, tooltips |
| `border` | `#262633` | Default hairline on surfaces and inputs |
| `border/subtle` | `#1C1C26` | Internal dividers, list separators |
| `border/strong` | `#33334A` | Edge-light on elevated surfaces, hovered inputs |
| `text/primary` | `#F1F0F7` | Titles, message bodies, names, values |
| `text/secondary` | `#A7A6B8` | Body copy, nav labels, descriptions |
| `text/muted` | `#6B6A7E` | Timestamps, helper text, placeholders, offline names |
| `text/inverse` | `#0C0C12` | Text on brass and success fills |
| `accent` (Ultraviolet 500) | `#6656F0` | Primary button fill, progress fill, active toggles |
| `accent/light` (Ultraviolet 300) | `#A99CFF` | Accent text, icons, links, blade, focus ring, mentions |
| `accent/glow` (Ultraviolet 200) | `#CFC8FF` | Highlights, mascot ring, edge-light on primary buttons |
| `accent/deep` (Ultraviolet 600) | `#5343D1` | Pressed primary, active progress track |
| `accent/tint` | `rgba(102,86,240,0.14)` | Selected backgrounds. Composite on surface ≈ `#1B1930` |
| `secondary` (Brass) | `#C9A961` | Owner rank, featured, "you" marker in rosters |
| `secondary/tint` | `rgba(201,169,97,0.12)` | Brass badge background |
| `success` | `#3DD68C` | Saved, connected, online |
| `warning` | `#F2B84B` | Unsaved changes, reconnecting, away |
| `danger` | `#F26D63` | Errors, failed connection, destructive text, muted-mic slash |
| `danger/fill` | `#C93A32` | Destructive button fill (white text, 5.1:1) |
| `online` | `#3DD68C` | Presence dot |
| `away` | `#F2B84B` | Presence dot |
| `offline` | `#4B4B5E` | Presence dot; offline names use `text/muted` |
| `live` | `#F26D63` | "LIVE" streaming marker |
| `focus` | `#A99CFF` | 2 px ring, 2 px offset in `bg/canvas` |
| `selection` | `rgba(102,86,240,0.35)` | Text selection. Composite ≈ `#2A2560` |

Contrast, measured: `text/primary` on `surface` 15.9:1; `text/secondary` on `surface` 7.8:1;
`text/muted` on `surface` 3.5:1 (non-essential text only); `accent/light` on `surface` 7.8:1;
white on `accent` 5.05:1; `secondary` on `surface` 8.2:1.

### 2.2 Rules of use

- Saturated accent (`accent`) covers under 1% of any screen. Primary buttons, progress fills,
  switch-on, the sign-in button. Nothing else is filled with it.
- `accent/light` is the working accent. Selected nav icon, blade, links, mention text, focus ring,
  active tab underline, the "#" of the current channel.
- `accent/glow` is only ever a 1 px line or a soft radial. It never fills a shape.
- Brass appears at most twice per screen. Owner badge, and a rank marker in the roster.
- Semantic colours mean one thing each. Green never decorates. Amber is never brand.
- No gradients on surfaces. The two permitted gradients: the sign-in / boot radial glow
  (`accent` at 18% to transparent, 600 px), and the 1 px edge-light on primary buttons
  (`accent/glow` at 35% top edge).

### 2.3 Mapping to the existing variables

| Existing variable | V2 value |
| --- | --- |
| `--background` | `#0C0C12` |
| `--surface`, `--card` | `#14141C` |
| `--elevated` | `#1A1A24` |
| `--popover` | `#1C1C27` |
| `--primary` | `#6656F0` |
| `--primary-foreground` | `#FFFFFF` |
| `--accent` (Tailwind "accent" = hover fill) | `#1F1F2A` |
| `--accent-text` | `#A99CFF` |
| `--muted` | `#1A1A24` |
| `--muted-foreground` | `#6B6A7E` |
| `--secondary-foreground` | `#A7A6B8` |
| `--foreground` | `#F1F0F7` |
| `--destructive` | `#F26D63` (text) / `#C93A32` (fill) |
| `--success` | `#3DD68C` |
| `--warning` | `#F2B84B` |
| `--offline` | `#4B4B5E` |
| `--border` | `#262633` |
| `--input` | `#262633` |
| `--ring` | `#A99CFF` |
| new `--sidebar` | `#07070A` |
| new `--border-subtle` | `#1C1C26` |
| new `--border-strong` | `#33334A` |
| new `--brass` | `#C9A961` |

---

## 3. Typography

### 3.1 Directions considered

| | Display | UI / chat | Metadata | Verdict |
| --- | --- | --- | --- | --- |
| T1 Quiet grotesk | Inter (tight) | Inter | JetBrains Mono | Safe. Status quo. Generic |
| **T2 Broadcast (recommended)** | **Archivo** | **Geist Sans** | **Geist Mono** | Clear hierarchy, esports weight in numerals, calm body |
| T3 Technical | Space Grotesk | IBM Plex Sans | IBM Plex Mono | Distinctive, but reads "developer tool" |

### 3.2 Families

- **Archivo** (variable: weight 100–900, width 62–125). One family; width is the expression.
  Titles at width 100. Stats at width 78 (semi-condensed). Eyebrows at width 112 (expanded), caps,
  tracked. Available on Google Fonts and Fontsource (`@fontsource-variable/archivo`).
- **Geist Sans** (variable). All UI text and chat. Neutral, slightly technical, holds up at 13 px,
  tabular figures available. Fontsource `@fontsource-variable/geist`.
- **Geist Mono** (variable). Metadata only. Fontsource `@fontsource-variable/geist-mono`.
- Fallback stack: `'Geist Variable', 'Inter Variable', system-ui, -apple-system, 'Segoe UI', sans-serif`.
  Inter stays installed as the fallback so nothing breaks before fonts load.

### 3.3 Scale

| Role | Family | Size / line | Weight | Tracking | Notes |
| --- | --- | --- | --- | --- | --- |
| Greeting (dashboard) | Archivo w100 | 26 / 32 | 600 | −0.015em | |
| Page title | Archivo w100 | 22 / 28 | 600 | −0.01em | Members, Settings |
| Dialog / sheet title | Archivo w100 | 18 / 24 | 600 | −0.01em | Profile |
| Section title | Geist | 15 / 20 | 600 | −0.005em | Team status, Recent activity |
| Card title | Geist | 13 / 20 | 600 | 0 | |
| Body | Geist | 13 / 20 | 400 | 0 | UI default |
| Chat message | Geist | 14 / 22 | 400 | 0 | One step up from UI; read for hours |
| Chat author | Geist | 14 / 22 | 600 | 0 | |
| Navigation | Geist | 13 / 20 | 500 | 0 | Selected changes colour, never weight |
| Form label | Geist | 12 / 16 | 500 | 0 | |
| Helper text | Geist | 12 / 16 | 400 | 0 | `text/muted` |
| Eyebrow / section label | Archivo w112 | 11 / 16 | 500 | +0.12em | Uppercase. CHANNELS, PINNED, ACTIVITY |
| Metadata / timestamp | Geist Mono | 11 / 16 | 400 | 0 | `text/muted` |
| Email / handle / ID | Geist Mono | 12 / 16 | 400 | 0 | |
| Keyboard hint | Geist Mono | 11 / 16 | 500 | 0 | In a 1 px hairline kbd chip |
| Stat number | Archivo w78 | 28 / 32 | 600 | −0.02em | Tabular numerals |
| Stat number, hero | Archivo w78 | 32 / 36 | 600 | −0.02em | Dashboard ribbon |
| Button | Geist | 13 / 20 | 500 | 0 | |
| Button small | Geist | 12 / 16 | 500 | 0 | |
| Badge | Geist | 11 / 16 | 600 | +0.02em | Sentence case, never caps |
| Tooltip | Geist | 12 / 16 | 500 | 0 | |
| Wordmark "LFHQ" | Archivo w118 | any | 700 | +0.06em | Caps. Sign-in and boot only |

Rules: hierarchy is size and colour before weight. Only two weights in UI text (400 and 500) and
one emphasis weight (600). Titles never exceed 600. Nothing is ever 700 except the wordmark.

---

## 4. Spacing system

4 px base. Tokens `sp-0.5` … `sp-16`.

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| sp-0.5 | 2 | | sp-6 | 24 |
| sp-1 | 4 | | sp-8 | 32 |
| sp-1.5 | 6 | | sp-10 | 40 |
| sp-2 | 8 | | sp-12 | 48 |
| sp-3 | 12 | | sp-16 | 64 |
| sp-4 | 16 | | | |
| sp-5 | 20 | | | |

Semantic spacing:

- **Micro** (inside a control): icon-to-label 8; badge padding 2×6; kbd chip 1×5; presence-dot
  offset 1 from the tile corner.
- **Component**: button padding 0×12 (sm 0×10, lg 0×16); input padding 0×12; card padding 16
  (compact 12); popover padding 4 (items 6×8); dialog padding 24; tooltip 4×8.
- **Section**: 24 between sections on a page; 16 between a section title and its content; 12
  between cards in a grid.
- **Page**: 24 horizontal and 20 top on desktop; 16 / 12 on mobile. Content max widths: dashboard
  1280, members 960, settings 760, chat fluid.
- **Sidebar**: 8 horizontal padding; rows 30 tall; 2 between rows; 16 between groups; group
  eyebrow 24 tall with 4 bottom margin; org header 56 tall; voice bar 8 margin all sides;
  profile footer 52 tall.
- **Chat**: message row padding 2×20 (right 16); avatar column 36 + 12 gap; 14 between author
  groups; 4 between consecutive messages of one author; 20 between date dividers; composer margin
  0×20 16; right panel padding 16, sections 20 apart.

Density target: the dashboard shows the same content in roughly 70% of its current height. The
sidebar shows two more rows per 100 px. Chat gains one message per screen over today.

---

## 5. Shape and radius system

| Token | px | Applies to |
| --- | --- | --- |
| r-1 | 2 | Badges, progress bars, blade, kbd chips, skeleton lines |
| r-2 | 4 | Buttons, inputs, selects, nav rows, chips, avatars ≤ 28 |
| r-3 | 6 | Cards, popovers, message hover, voice bar, avatars 32–40 |
| r-4 | 10 | Dialogs, sheets, avatars 64+ |
| r-5 | 16 | Mobile bottom-sheet top corners, mascot containers |
| r-full | 9999 | Presence dots, status pills, switches |

The LFHQ shape language has three signatures.

1. **Hairline.** Every surface is defined by a 1 px edge, not by a fill difference alone.
2. **Blade.** Selection is a 2 px vertical accent bar, 16 px tall, radius 1, at the left of the
   selected item. Used in sidebar nav, settings sub-nav and tabs (rotated to horizontal, 2 px under
   the active tab). It is the one place the accent draws a line.
3. **Edge-light.** Elevated and overlay surfaces carry a 1 px top border one tone lighter than
   their sides (`border/strong` over `border`). Primary buttons carry a 1 px `accent/glow` at 35%
   along the top. Light comes from above, the way a screen lights a face.

Not in the language: chamfers, hexagons, shields, glass blur, inner shadows, 2 px borders on
resting elements, pill-shaped buttons, circular avatars.

---

## 6. Border system

| Level | Colour | Where |
| --- | --- | --- |
| Subtle | `#1C1C26` | Dividers inside a surface, list separators, message date rules |
| Default | `#262633` | Surface edges, inputs, cards, composer, right panel edge |
| Strong | `#33334A` | Edge-light, hovered input, hovered secondary button |
| Accent | `#A99CFF` | Focused input, selected segmented control, active tab |
| Danger | `#F26D63` | Invalid input |

Always 1 px. The sidebar has no right border; the canvas is lighter and the tonal step is the
edge. The right panel in chat has a Default left border.

---

## 7. Surface and elevation system

```
L-1  bg/sidebar   #07070A   the pit — sidebar, mobile tab bar
L0   bg/canvas    #0C0C12   the floor — content, input wells
L1   surface      #14141C   cards, panels, composer, right panel      + border
L2   elevated     #1A1A24   voice bar, chips, secondary buttons        + border, edge-light
L3   overlay      #1C1C27   popovers, dropdowns, dialogs, tooltips     + border, edge-light, shadow
```

- Hover: one tonal step up (`surface/hover`). Never a shadow.
- Active / selected: `surface/active` (accent tint) plus the blade where the component has one.
- Pressed: one tonal step down from hover for 80 ms.
- Shadow exists only on L3: `0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px #262633`. Dialogs add a
  backdrop of `rgba(7,7,10,0.72)` with no blur.
- Glow is permitted in four places only: focus ring, speaking ring, primary-button hover
  (`0 0 0 1px rgba(169,156,255,0.4), 0 0 16px rgba(102,86,240,0.25)`), and the loading bar fill
  (`0 0 8px rgba(102,86,240,0.6)`).
- Gradients: the two listed in §2.2. No others.
- Inputs sit *below* their surface (L0 well inside an L1 card). Everything else sits above.

---

## 8. Component language

### 8.1 Buttons

| Variant | Rest | Hover | Press | Text |
| --- | --- | --- | --- | --- |
| Primary | `accent` fill, top edge-light | lighten to `#7565FF` + glow | `accent/deep` | white 500 |
| Secondary | `surface/elevated` + `border` | `surface/hover` + `border/strong` | `surface` | `text/primary` |
| Ghost | transparent | `surface/hover` | `surface` | `text/secondary` → primary on hover |
| Danger (text) | transparent | `rgba(242,109,99,0.10)` | darker | `danger` |
| Danger (solid, confirm dialogs only) | `danger/fill` | lighten | darken | white |
| Icon | as Ghost, square | | | icon 18 |

Sizes: sm 28, md 32, lg 36, xl 40 (sign-in only). Radius r-2. Icon 16 in sm, 18 in md/lg.
Loading: spinner 14 replaces the leading icon; label stays; width locked. Disabled: 40% opacity,
no hover. Focus: 2 px `focus` ring, 2 px offset.

### 8.2 Inputs and selects

- Well: `bg/canvas` fill inside `surface`. Border Default. Radius r-2. Height 32 (lg 36, xl 40).
- Hover: border Strong. Focus: border `accent/light` and a 3 px ring `rgba(169,156,255,0.22)`.
- Placeholder `text/muted`. Value `text/primary`. Leading icon 16 `text/muted`.
- Error: border `danger`, helper text `danger`, icon `WarningCircle` 14 before the helper.
- Select: same well, trailing `CaretDown` 16. Menu is an L3 overlay, items 28 tall, selected item
  shows `Check` 14 in `accent/light`.
- Textarea: min 3 lines, resize handle hidden, grows to 8 lines.
- Search: `MagnifyingGlass` 16 leading, kbd chip trailing (`Ctrl K`), width 240 in top bar.
- Read-only identity fields (org handle, email): rendered as a mono chip on `surface/elevated`
  with a `LockSimple` 14 trailing, not as a disabled input.
- Switch: 32×18, track `border/strong`, on = `accent`, knob white, r-full.
- Required marker: `accent/light` asterisk, not red.

### 8.3 Badges

| Badge | Text | Background | Border |
| --- | --- | --- | --- |
| Owner | `secondary` (brass) | `secondary/tint` | 1 px brass at 30% |
| Admin | `accent/light` | `accent/tint` | 1 px accent at 30% |
| Member | `text/secondary` | `surface/elevated` | 1 px `border` |
| You | `text/muted` | none | 1 px `border` |
| Online / Away / Offline (pill) | matching semantic | none | none; dot 6 + text |
| Unread count | `text/primary` mono 11 | `surface/elevated` | none |
| Mention count | white mono 11 | `accent` | none |
| LIVE | white, caps, Archivo w112 | `live` | none |

Height 20, padding 2×6, radius r-1 (pills r-full). Leading icon 12 where it clarifies
(ShieldCheck for Owner, Shield for Admin).

### 8.4 Avatars

Rounded-square tiles. Sizes and radii: 20 r-2 · 24 r-2 · 28 r-2 · 32 r-3 · 40 r-3 · 64 r-4 ·
96 r-4. Initials: Archivo w100 600, two letters, uppercase, 42% of tile size. Fallback fill is one
of six muted tints keyed by name hash, each at 22% with matching 300-tone text: slate `#8A93B8`,
violet `#A99CFF`, teal `#6FD3C4`, brass `#C9A961`, rose `#E08A9A`, moss `#9DC48A`. Uploaded photos
render with a 1 px `border/subtle` inset. Presence dot: 8 px at ≥ 32, 6 px below; bottom-right;
cut out by a 2 px ring in the parent background colour. Speaking: 2 px `success` ring outside the
tile, 1 px gap. Org tile: same shape, 32 in sidebar, monogram in Archivo w112.

### 8.5 Navigation items

Row 30 tall, padding 0×8, radius r-2, icon 18 `text/muted`, label 13/500 `text/secondary`, count
right-aligned mono 11.

- Hover: `surface/hover`, label and icon `text/primary`.
- Selected: `surface/active`, label `text/primary`, icon `accent/light` in Phosphor **fill**
  weight, blade at x = −8 (in the sidebar gutter).
- Unread: label `text/primary` 600 (the only weight change, because it *is* a state, not
  selection) and a 6 px `text/primary` dot at right.
- Muted channel: label `text/muted`, `BellSlash` 12 trailing.
- Voice channel: `SpeakerHigh` icon; connected count mono; when expanded, participant sub-rows 24
  tall with 20 px avatars indented 26.
- Group eyebrow: Archivo w112 11 caps `text/muted`, `CaretDown` 12 leading, count at right, `Plus`
  16 on hover. Collapsed groups keep unread channels visible.

### 8.6 Cards and panels

L1 surface, Default border, r-3, padding 16. Title row: card title 13/600 left, action (ghost
sm or link) right. No card shadows. Cards never nest in cards. A group of stats is a **ribbon**
(one surface with Subtle vertical dividers), not a grid of equal cards.

### 8.7 Dialogs, sheets, popovers, tooltips

- Dialog: L3, r-4, max-width 480 (profile 560, confirm 400), padding 24, edge-light, shadow,
  backdrop 72%. Header: title 18 Archivo + optional description 13 muted. Footer: right-aligned,
  secondary then primary, 8 gap. Close icon top-right ghost 28.
- Sheet (mobile): from bottom, r-5 top corners, drag handle 32×4 `border/strong`.
- Popover / menu: L3, r-3, padding 4, items 28 tall r-2, destructive items `danger` with Subtle
  divider above. Width fits content, min 180.
- Tooltip: L3, r-2, 12/500, padding 4×8, 6 px offset, no arrow.

### 8.8 Kbd chip

Mono 11/500, `surface/elevated`, Default border, r-1, padding 1×5, `text/secondary`.

### 8.9 Tabs

Text 13/500 `text/secondary`, 36 tall, gap 24, no background. Active: `text/primary` and a 2 px
`accent/light` blade beneath, width of the label. Hover: `text/primary`. A hairline Subtle rule
runs under the whole tab row. At ≥ 1024 in Settings, tabs become a vertical sub-nav (§14).

### 8.10 Progress bar (native UI)

Track 2 px `border`, r-1. Fill `accent`, r-1, with the loading-bar glow. Determinate: width
transition 220 ms. Indeterminate: 40%-wide fill sweeping left-to-right, 1.4 s, standard easing.
Route-level: fixed at the top edge of the content area, full width, 2 px.

### 8.11 Skeletons

`surface/elevated` blocks, r-1 for text lines (height 12, widths 40/70/55%), r-3 for avatar
tiles and cards. Shimmer: 1.6 s sweep of `rgba(255,255,255,0.05)`. No mascot in skeletons.

---

## 9. Sidebar direction

Width 256 (collapsed 64, icons only with tooltips). Background `bg/sidebar`. No right border.

```
┌────────────────────────────┐
│ [ES] Esport Esportan aja   │  56 · org tile 32 r-3 · name 13/600 · handle @lfg mono 11 muted
│      @lfg · 3 online   ▾   │  chevron opens org menu (switch org, settings, sign out)
├────────────────────────────┤
│ ▦ Dashboard                │  30 · selected: blade + accent icon (fill) + surface/active
│                            │
│ CHANNELS                +  │  eyebrow, Archivo expanded, 11
│ ▾ CHATTINGAN AJA         1 │  category, count of unread
│   # Slurpies             3 │  unread: 600 + dot; count mono
│   🔊 Voice · Slurpies    2 │  voice channel, connected count
│      ▪ LuwisH              │  participant sub-row, 24, speaking ring on tile
│      ▪ AGER                │
│   Browse channels          │  ghost row, text/muted, 13
│                            │
│ DIRECT MESSAGES          + │
│   [AG] AGER            ●   │  20 px tile + presence dot, name 13
│   [AC] auznaf14        ○   │
│                            │
│ ORGANIZATION               │
│   ⚇ Members                │
│   ⚙ Settings               │
│                            │  flexible space
├────────────────────────────┤
│ ● VOICE · CONNECTED    ▮▮▮ │  voice session bar, L2, r-3, edge-light  (§12)
│   Slurpies · 2 connected   │
│   [🎙] [🎧] [⤴ Leave]      │
├────────────────────────────┤
│ [LU] LuwisH          ⚙  ⏻ │  52 · tile 28 + presence · name 13/600 · role 11 muted
│      Owner                 │  hover reveals settings + sign out ghosts
└────────────────────────────┘
```

Changes from today, and why:

- **Org header** gains the handle and a live "n online" count in mono. It reads as an HQ, not
  as a settings label. The tagline moves to the org menu and the dashboard.
- **"SOON" rows are removed.** Unreleased modules do not appear in navigation. When Calendar
  ships, its row appears. The nav lists what exists.
- **Channel hierarchy** gets three levels of tone: category eyebrow (muted, expanded caps),
  channel (secondary), selected channel (primary + blade). Unread is a weight and a dot, not a
  colour. Voice channels show who is in them, so the sidebar answers "who is talking right now"
  without opening anything.
- **DMs** use 20 px tiles with presence dots so they read as people, not as email addresses.
  Display name first; fall back to the local part of the email, never the full address.
- **Voice bar** occupies a fixed slot above the profile whenever a session exists (§12). When
  no session exists the slot collapses; nothing else moves.
- **Profile footer** becomes a row with a tile avatar, name, role in muted, and actions on hover.
  The lone sign-out icon goes into hover and the org menu.
- **Empty vertical space** is acceptable in a sidebar. It is fixed by a richer header and a
  grounded footer, not by filling it.

---

## 10. Dashboard direction

Max width 1280. Padding 24. The page answers "what is happening in my organisation right now"
in the first 400 px.

```
SUNDAY 6 SEPTEMBER                                              [Invite member]
Good evening, LuwisH                                 (Archivo 26/600)
Esport Esportan aja · Owner                          (13 muted, brass "Owner")

┌──────────────┬──────────────┬──────────────┬────────────────┐   status ribbon, ONE surface
│ ACTIVE       │ AROUND NOW   │ PENDING      │ YOUR ROLE      │   eyebrows 11, subtle dividers
│ 3            │ 1            │ 0            │ Owner          │   numbers Archivo w78 32/600
│ in this org  │ last 30 min  │ awaiting     │ 39 permissions │   13 muted
└──────────────┴──────────────┴──────────────┴────────────────┘

┌ Team status ─────────────────── All members → ┐ ┌ Recent activity ───────────────────┐
│ [LU] LuwisH   QA 340      Owner   ● Online    │ │ 22:41  Channel probe voice deleted │
│ [LD] AGER     Admin       Admin   ○ Offline   │ │        LuwisH                      │
│ [AC] auznaf14 Admin       Admin   ○ Offline   │ │ 22:41  Joined voice · probe voice  │
│                                               │ │ 22:39  Channel probe voice created │
│                                               │ │ ...                                │
└───────────────────────────────────────────────┘ └────────────────────────────────────┘
        7 / 12 columns                                    5 / 12 columns
```

- The four stat cards become **one ribbon**. Same data, one surface, subtle dividers, hero
  numerals. It removes the "card grid" look and halves the height.
- **"Today's schedule / Active projects / Your tasks" placeholders are removed** together with
  their "Phase 3 / Phase 4" tags. They return as real modules when those modules ship. A dashboard
  that describes its own roadmap looks unfinished.
- **Team status** is the primary panel: presence-sorted (online first), tile avatars 32, title in
  muted, role badge, presence pill. It is the roster at a glance.
- **Recent activity** is a timeline with mono timestamps in a left column and one-line events.
  Actor in `text/secondary`, object in `text/primary`. Events group under date rules.
- The greeting is the only display-size text on the page. Everything else is UI scale.
- "Invite member" is the single primary action on the dashboard.

---

## 11. Chat and DM direction

The structure stays. The treatment changes.

**Channel header** 48 tall, Subtle bottom rule. `#` in `accent/light`, name 15/600, topic 13
muted after a `·`. Right: search, pin count, settings, panel toggle as icon buttons 28. In a DM
the header shows a 24 px tile with presence and the person's title in muted.

**Messages**

- Author group: tile 36 r-3, author 14/600 `text/primary`, timestamp mono 11 muted 8 px after.
  Roles are not badged inline; hovering the name shows the member card.
- Body 14/22 `text/primary`. Chat is the app's main reading surface and gets the highest
  contrast. System lines ("This message was deleted") are italic `text/muted`.
- Consecutive messages: 4 px apart, timestamp revealed in the gutter on hover, mono 11.
- Hover: full-width `surface` band, r-3 inset 8 px from the edges. The action bar floats at the
  top-right of the band: L3 chip, r-2, icons 16 (React, Reply, Pin, More), 28 tall.
- Mention: `accent/tint` background, `accent/light` text, r-1, padding 0×4. A message that
  mentions you gets a 2 px `accent/light` blade in the gutter and a 6% accent tint band.
- Reply: 1 px Subtle vertical connector from the tile to a 12/400 quoted line, muted, name in
  secondary.
- Reactions: chips 24 tall r-2, `surface/elevated`, count mono; own reaction has `accent`
  30% border and `accent/tint` fill.
- Attachments: file chips 40 tall with type icon 20, name 13, size mono 11; images r-3 max 400
  wide, 1 px Subtle inset border.
- Date divider: Subtle rule with the date in mono 11 muted centred, 20 above and below.
- Pinned messages get a `PushPin` 12 in `secondary` (brass) before the timestamp.

**Composer** L1 surface, Default border, r-3, min height 44, grows to 10 lines. Placeholder
"Message #Slurpies" muted. Focus: border `accent/light`, no ring (the border is the ring).
Trailing icon buttons 28: emoji, attach, send. Send is ghost until there is content, then
`accent/light`. The hint line ("Enter to send · Shift+Enter for a new line") moves *under* the
composer at mono 11 muted and disappears after the first message sent this session.

**Right panel** 288 wide, Default left border, padding 16. Sections with eyebrows: CHANNEL
(name, topic, edit link), PINNED (count, list of 2-line previews), MEMBERS (grouped online /
offline, 24 px tiles, role in muted), ACTIVITY (Voice and Streaming rows with a state dot and the
join / watch action). In a voice-active channel the Voice row expands into the participant list.

**Selected states**: the current channel in the sidebar has the blade; the header `#` is accent.
Nothing else in the chat area is accent unless it is a mention, a link or a focus.

---

## 12. Voice direction

### 12.1 Persistent voice session bar

L2 surface, r-3, Default border with edge-light, 8 px margin inside the sidebar, above the
profile footer. Three rows, 92 tall total.

```
┌──────────────────────────────────┐
│ ● VOICE · CONNECTED         ▮▮▮  │  row 1 · state dot 6 · eyebrow mono 11 · signal bars 12
│ Slurpies                         │  row 2 · 13/600 primary · "2 connected" 12 muted after ·
│ 2 connected  ▪▪▪                 │           tiny 3-bar level meter when anyone speaks
│ [ Mic ]  [ Headphones ]  [Leave] │  row 3 · icon buttons 28, r-2 · Leave is danger-text ghost
└──────────────────────────────────┘
```

| State | Dot | Eyebrow | Body | Controls |
| --- | --- | --- | --- | --- |
| Connected | `success` static | VOICE · CONNECTED | channel, count | all enabled |
| Connecting | `warning` breathing 1.2 s | VOICE · CONNECTING… | channel | mic/deafen disabled at 40% |
| Reconnecting | `warning` breathing | RECONNECTING · 2/5 (mono) | channel | as connecting |
| Failed | `danger` static | CONNECTION FAILED | "Retry" link in `accent/light` | Leave only |
| Muted | as connected | VOICE · CONNECTED | count | `MicrophoneSlash` in `danger`, button bg `rgba(242,109,99,0.10)` |
| Deafened | as connected | | | headphones slashed `danger`, mic also shown slashed |
| Listen-only | `accent/light` static | VOICE · LISTENING | channel | `Headphones` accent, mic hidden |
| PTT armed | as connected | | | mic button shows `PTT` mono 10 chip; pressed = `accent` fill |
| Speaking (you) | as connected | | level meter animates | mic button 1 px `success` border |

The bar never changes height between states. Text never wraps; long channel names truncate.

### 12.2 Speaking indicator

2 px `success` ring outside the avatar tile with a 1 px gap. Fades in 100 ms, holds while
speaking, fades out 300 ms. No pulse loop, no glow halo. In the sidebar participant sub-rows the
same ring applies at 20 px tiles (1.5 px ring). In the voice panel the tile ring plus the name in
`text/primary` (others in `text/secondary`).

### 12.3 Voice channel row and participant list

Sidebar row: `SpeakerHigh` 18, name, count mono. Sub-rows 24 tall, 20 px tiles, name 12, trailing
state icons 12 (`MicrophoneSlash` muted grey, `SpeakerSlash` for deafened, `Headphones` accent
for listen-only). Your own sub-row has `surface/active`.

Voice panel (right panel of a voice channel, or the Activity section): participant rows 44 tall,
tile 32 + speaking ring, name 13/500, state icons 14, per-user volume slider appears on hover or
on the `…` menu: 2 px track `border`, `accent/light` fill, 12 px knob, mono percentage.

### 12.4 Connection state elsewhere

- Org header shows a `warning` dot before the online count while reconnecting.
- A 2 px `warning` route bar at the top of the content area during a realtime reconnect; it
  becomes `success` for 600 ms on recovery, then disappears.
- Failure: a one-line L2 banner at the top of the content area, `danger` dot, "Connection lost.
  Retrying…" mono, no dismiss; it goes away on its own.

---

## 13. Members and roster direction

Page title "Members" 22 Archivo, description 13 muted, "Invite" primary md at right. Search well
240 with role filter chips (All · Owner · Admin · Member) as a segmented control: 28 tall,
`surface/elevated`, active segment `surface/active` + accent text.

Rows grouped by role, each group with an eyebrow and count (OWNER · 1, ADMINS · 2,
MEMBERS · 0). Row 56 tall, Subtle divider, no per-row card:

```
[LU]  LuwisH  ·You·           QA 340                     ● Online          Owner     …
 40   13/600  You-badge       12 muted                   pill              badge     28
      luwishengdriano@gmail.com (mono 12 muted)          Joined 4 Sep (mono 11)
```

- Identity: tile 40, name 13/600, title 12 muted on the same line, email mono on the second line.
- Presence pill: dot + "Online" / "Seen 2h ago" / "Offline"; offline names drop to `text/secondary`.
- Role badge per §8.3; Owner brass.
- Actions: `…` ghost 28, visible on hover and focus; menu with Change role / Remove (danger).
- Hover: `surface/hover` band. Selected (keyboard): blade.
- The whole row is the roster; the roster is not a table. There are no column headers.

Empty search result: mascot 72 (confused pose) with "No one matches that." 13 muted.

---

## 14. Settings direction

Page title "Settings" 22 Archivo, description 13 muted. At ≥ 1024, tabs become a **vertical
sub-nav** 200 wide at the left of the content (Organization / Roles & permissions / Channels),
nav rows per §8.5 with blades. Below 1024, horizontal tabs per §8.9.

Content max 760. Each logical group is a **section card**: L1, r-3, padding 24, with a header
(title 15/600, description 13 muted, Subtle rule) and fields 16 apart.

- Field: label 12/500 above, well input, helper 12 muted below. Required asterisk accent.
- Handle: mono chip with lock, helper "Permanent identifier. Cannot be changed."
- Timezone: select with search inside the menu.
- **Save bar**: hidden until the form is dirty, then slides up (160 ms) as an L2 bar pinned to the
  bottom of the content column: `warning` dot + "Unsaved changes" 13 left, Discard ghost + Save
  primary right. After save: `success` dot + "Saved" for 1.5 s, then the bar leaves.
- Roles & permissions: role list at left as nav rows (Owner brass, Admin accent, Member), the
  permission matrix at right as grouped switch rows 36 tall with Subtle dividers, group eyebrows.
  Owner permissions are read-only chips, not disabled switches.
- Channels: channel rows 44 tall with `#` / `SpeakerHigh`, name, category in muted, member count
  mono, `…` actions. Categories as collapsible groups. "New channel" secondary at the top right.

Settings uses the same rows, badges, wells and eyebrows as everything else. It is the same
product.

---

## 15. Profile direction

Keep the dialog on desktop (560 wide, r-4). Full-screen sheet on mobile. Two zones:

```
┌─ identity band ────────────────────────────────── × ┐   bg/canvas inside the dialog,
│ [LU]  LuwisH                          Owner (brass)  │   1 px accent/glow edge-light at top,
│  64   QA 340 · luwishengdriano@gmail.com (mono 12)   │   radial accent glow 18% behind tile,
│       UTC · 09:41 local                              │   padding 24, tile 64 r-4 + Change link
├─ form ──────────────────────────────────────────────┤
│ Display name*      [LuwisH               ]           │   L3 surface, padding 24
│ Full name          [                     ]           │
│ Title              [QA 340               ]  helper   │
│ Bio                [                     ]           │
│ Timezone*          [UTC               ▾ ]  helper    │
├─────────────────────────────────────────────────────┤
│                              [Close]  [Save changes] │   footer, Save disabled until dirty
└─────────────────────────────────────────────────────┘
```

The identity band is the only place in the app where the accent radial glow appears behind
content, and it is at 18%. The same band, at 40 px tile and no form, is the **member card**
popover shown when hovering a name in chat or the roster.

---

## 16. Sign-in direction

Two panes at ≥ 900. Left 55%: `bg/sidebar` with the mascot; right 45%: `bg/canvas` with the form.

```
┌───────────────────────────────────┬──────────────────────────────┐
│ LF  LFHQ                          │                              │
│     PRIVATE ORGANIZATION WORKSPACE│   Sign in            (22)    │
│                                   │   LFHQ is invitation-only.   │
│           (radial glow 18%)       │   Use the account your       │
│                                   │   organization set up for    │
│          [ mascot, 320 px,        │   you.                       │
│            typing pose, static ]  │                              │
│                                   │   Email*    [            ]   │  xl wells, 40
│                                   │   Password* [            ]   │
│                                   │   [      Sign in         ]   │  primary xl, full width
│                                   │   Forgot your password?      │  link accent/light
│  MORE THAN A TEAM        v1.0     │   ── or ──                   │
│  (Archivo w112, 11, tracked)      │   Email me a sign-in link    │  secondary xl
└───────────────────────────────────┴──────────────────────────────┘
```

- The mascot sits low-left, cropped by the bottom edge, so it is a presence, not a poster.
- Background of the left pane: a 1 px grid at 3% white, 32 px cells, fading to nothing 200 px
  from the mascot. It is the only decorative background in the app.
- Form: no card. The right pane *is* the surface. Fields at xl size for a first-touch screen.
- Loading: the button locks width, shows a 14 px spinner and "Entering HQ…". On success the
  right pane fades 120 ms and the boot loading screen (§17) takes over. On error the field turns
  `danger` with helper text and the button re-enables. No shake.
- Below 900: single column. Wordmark row at the top, mascot 96 centred above "Sign in", form
  full-width, 16 padding.

---

## 17. Loading direction

### 17.1 Boot (first paint after sign-in, org switch, cold reload)

Full-screen `bg/sidebar`. Centred column, 280 wide:

1. Mascot animation, 240 px (the typing → pause → "?" → typing loop, produced in Higgsfield,
   delivered as a looping video or Lottie with alpha, glow in `accent/glow`).
2. Wordmark "LFHQ" Archivo w118 700, 28, `text/primary`, 24 below the mascot.
3. "MORE THAN A TEAM" Archivo w112 11 tracked, `text/muted`, 8 below.
4. **Progress bar** 240×2, native (§8.10), 32 below. Determinate when the boot has known steps
   (session, org, channels, presence, voice); indeterminate otherwise.
5. Status line mono 11 `text/muted`, 16 below, rotating through real steps: "Restoring session",
   "Loading organization", "Opening channels", "Connecting presence". Never fake copy.

Minimum display 600 ms so it never flashes. Exit: 160 ms fade to the app.

### 17.2 Route loading

No mascot. 2 px route bar at the top of the content area plus skeletons in the content's own
layout. The sidebar never skeletons.

### 17.3 Connection loading

Per §12.4. Dots and route bar; no mascot.

### 17.4 Voice connecting

Voice bar Connecting state (§12.1). Nothing appears in the content area.

### 17.5 File upload

Attachment chip in the composer (40 tall): file icon, name 13, mono percentage at right, and a
2 px `accent` bar along the chip's bottom edge, r-1. On completion the bar becomes `success` for
600 ms then disappears. On failure the chip border turns `danger` with a Retry link.

### 17.6 Skeletons

Per §8.11.

---

## 18. Mascot usage

The mascot is a signature, not wallpaper. One mascot per screen at most.

**Appears**

- Boot loading (animated, 240).
- Sign-in (static typing pose, 320 desktop / 96 mobile).
- Empty states, static, 72–96: no channels yet, no DMs yet, no members match, no pinned
  messages (right panel, 48 with the "?" pose), no activity yet.
- Errors: 404 and "you lost connection" full-page states (confused pose, "?" visible).
- First-run onboarding, if an onboarding step exists: one appearance on the welcome step.

**Never appears**

- In the sidebar, headers, dashboard cards, settings, profile, or the voice bar.
- As a default avatar.
- Inside chat messages, reactions, emoji sets or notifications.
- On buttons, badges, tooltips or route loading.
- Animated anywhere except boot loading. Everywhere else it is a still.

Colour treatment: the mascot's glow is `accent/glow` on `accent`. Its black is `bg/sidebar`. It
is always placed on `bg/sidebar` or `bg/canvas`, never on a surface, so its body merges with the
ground and only the glow reads.

---

## 19. Motion system

Durations: `80` press · `120` hover, tooltip, fade · `160` selection, dialog enter, tab · `220`
sidebar collapse, progress · `320` speaking-ring out. Nothing longer, except loops.

Easing: standard `cubic-bezier(0.2, 0, 0, 1)`; exit `cubic-bezier(0.4, 0, 1, 1)`. No spring, no
overshoot.

| Interaction | Behaviour |
| --- | --- |
| Hover | background and colour 120 ms. No transform |
| Press | background to pressed tone in 80 ms. No scale |
| Selected | blade scales from 0 to 16 tall (transform-origin centre) 160 ms; background 120 ms |
| Focus | ring appears instantly. Never animated |
| Dialog enter | opacity 0→1, translateY 8→0, scale 0.98→1, 160 ms standard; backdrop fade 160 |
| Dialog exit | opacity 1→0, scale 1→0.98, 120 ms exit |
| Dropdown / popover | opacity 0→1, translateY −4→0 from the anchor side, 120 ms |
| Sidebar collapse | width 256→64, 220 ms; labels fade out 80 ms first |
| Page transition | content opacity 0→1 120 ms. No slide. Sidebar and header do not move |
| Route bar | indeterminate sweep 1.4 s loop; completes to 100% in 220 then fades 120 |
| Skeleton | shimmer 1.6 s loop |
| Speaking ring | in 100 ms, out 300 ms |
| Connecting dot | opacity 0.4↔1, 1.2 s loop. The only breathing element in the app |
| Save bar | translateY 100%→0, 160 ms; leaves 120 ms |
| Toast | from top-right, translateY −8→0 and fade 160 ms; auto-dismiss 4 s |
| Reaction added | chip scale 0.9→1 120 ms once |

Rules: at most one looping animation visible at a time besides the connecting dot.
`prefers-reduced-motion` removes all transforms and loops; opacity fades stay at 80 ms.

---

## 20. Iconography

Phosphor stays.

- Sizes: 16 inline and metadata, 18 navigation and buttons, 20 headers and toolbars, 24 empty
  states and dialogs. Never 14 except badge glyphs (12–14).
- Weight: **regular** at rest, **fill** for the selected navigation item and active toggles
  (muted mic, deafened). Never bold, never duotone, never thin.
- Colour follows text: `text/muted` at rest in nav and rows, `text/secondary` in body,
  `text/primary` on hover, `accent/light` when selected, semantic for state.
- Alignment: optical centre on the text's x-height line; 8 px to the label; icon-only buttons
  are square (28 or 32) with the icon centred.
- One icon per concept across the app: `Hash` channel, `SpeakerHigh` voice channel,
  `Microphone` / `MicrophoneSlash`, `Headphones` / `SpeakerSlash`, `SignOut` leave, `ShieldCheck`
  owner, `Shield` admin, `PushPin`, `ArrowBendUpLeft` reply, `Smiley` react, `Paperclip`,
  `PaperPlaneRight` send, `MagnifyingGlass`, `Gear`, `Users`, `SquaresFour` dashboard.

---

## 21. Mobile direction

Below 768. Touch targets 44 minimum. Safe areas respected.

- **Navigation**: bottom tab bar 56 + safe area, `bg/sidebar`, top Subtle rule. Five tabs: Home,
  Channels, Messages, Members, You. Active: `accent/light` fill icon + label 10/500. Unread dots
  on Channels and Messages.
- **Sidebar** does not exist as a drawer. "Channels" is a full screen: org header, categories,
  voice channels with participants, "Browse". "Messages" is the DM list with 32 px tiles.
- **Chat**: header 48 with back chevron, `#` name, panel toggle. Messages at 14/22, avatar 32,
  row padding 2×16. Hover actions become long-press → bottom sheet (React, Reply, Pin, Copy,
  Delete). Right panel is a full-screen sheet.
- **Composer** sticky above the keyboard and above the tab bar, 44 min, r-3, attach and emoji
  inside, send button appears with content. Hint line removed.
- **Voice bar** becomes a 40 px strip pinned directly above the tab bar (or above the composer in
  chat): state dot, "Slurpies · 2", mic and leave icons at right. Tapping it opens the voice sheet
  with the participant list and full controls.
- **Dashboard**: greeting, ribbon as a 2×2 grid of stat tiles (one surface, subtle dividers), team
  status list, activity list. Nothing side by side.
- **Members**: same rows at 64 tall, `…` always visible, filters as a horizontally scrolling chip
  row.
- **Settings**: a list of sections; each opens its own screen with a back header. Save bar pinned
  above the tab bar.
- **Profile**: bottom sheet, r-5 top, identity band then form.
- **Sign-in**: single column per §16.
- **Loading**: boot identical, mascot 180.

---

## 22. Design philosophy

1. **Black is the brand.** LFHQ is the darkest thing on the user's screen. Grey is what other
   tools do.
2. **Light, not paint.** The accent is a glow, a line, a ring. It marks state. It never fills
   space.
3. **Hierarchy by type.** Titles, numerals and eyebrows carry structure. Boxes are hairlines.
4. **Dense, not cramped.** Tight rows, generous sections. Two more rows per screen, never two
   fewer pixels of line height.
5. **Quiet motion.** Everything moves once, fast, and stops.
6. **The mascot signs, it does not decorate.** Five places. Nowhere else.
7. **Ship what exists.** No "soon", no "phase". The interface lists what the organisation can do
   today.

---

## Appendix A — Token sheet for implementation

```
--bg-canvas:        #0C0C12   --text-primary:   #F1F0F7   --accent:        #6656F0
--bg-sidebar:       #07070A   --text-secondary: #A7A6B8   --accent-light:  #A99CFF
--surface:          #14141C   --text-muted:     #6B6A7E   --accent-glow:   #CFC8FF
--surface-elevated: #1A1A24   --text-inverse:   #0C0C12   --accent-deep:   #5343D1
--surface-hover:    #1F1F2A                                --accent-tint:   rgba(102,86,240,.14)
--surface-active:   #1B1930   --border:         #262633   --brass:         #C9A961
--surface-overlay:  #1C1C27   --border-subtle:  #1C1C26   --brass-tint:    rgba(201,169,97,.12)
                              --border-strong:  #33334A
--success: #3DD68C  --warning: #F2B84B  --danger: #F26D63  --danger-fill: #C93A32
--online:  #3DD68C  --away:    #F2B84B  --offline: #4B4B5E  --live: #F26D63
--focus:   #A99CFF  --selection: rgba(102,86,240,.35)

--radius-1: 2px  --radius-2: 4px  --radius-3: 6px  --radius-4: 10px  --radius-5: 16px
--space: 2 4 6 8 12 16 20 24 32 40 48 64
--font-display: 'Archivo Variable'   (wdth 100 titles · 78 stats · 112 eyebrows · 118 wordmark)
--font-ui:      'Geist Variable'
--font-mono:    'Geist Mono Variable'
--shadow-overlay: 0 12px 32px rgba(0,0,0,.6), 0 0 0 1px #262633
--glow-focus:    0 0 0 2px #0C0C12, 0 0 0 4px #A99CFF
--glow-primary:  0 0 0 1px rgba(169,156,255,.4), 0 0 16px rgba(102,86,240,.25)
--glow-progress: 0 0 8px rgba(102,86,240,.6)
--ease: cubic-bezier(.2,0,0,1)   --ease-exit: cubic-bezier(.4,0,1,1)
--dur-press: 80ms  --dur-hover: 120ms  --dur-select: 160ms  --dur-layout: 220ms
```

## Appendix B — What the implementation stage must not do

- Add a light theme.
- Introduce any font beyond Archivo, Geist Sans, Geist Mono.
- Use the accent as a background larger than a button.
- Add shadows below L3.
- Add any looping animation other than route bar, skeleton shimmer and the connecting dot.
- Show the mascot outside §18.
- Reintroduce "SOON" or "Phase" labels anywhere users can see.
