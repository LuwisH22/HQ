# LFHQ Calendar — UX and Motion Audit

Phase 4.5 · Interaction design · No production code.
Visual source of truth: `LFHQ-VISUAL-DESIGN-SYSTEM-V2.md` (Blackout). This document decides
how the calendar behaves; that one decides how it looks.

---

## 0. Where we start

What exists today in `src/features/calendar`:

- Three grid views (month, week, day) with a segmented switcher and prev/next.
- Four Radix dialogs stacked on top of the grid: detail, create, edit, delete. The detail dialog
  hands off to edit or delete by closing itself first.
- Event model: title, description, location, starts/ends instants, all-day flag, timezone, one of
  seven types (match, scrim, practice, meeting, content, event, other), reminder minutes, creator.
  No attendees. No colour per type: brass mark for match, accent mark for scrim, neutral for the
  rest.
- Realtime invalidation of the calendar query family on any insert, update or delete.
- Permissions: `calendar.view` gates the page; `use-can-edit-event` allows the creator or a
  manager.

What the reference image gets right, and what it gets wrong for LFHQ:

| Reference | Verdict for LFHQ |
| --- | --- |
| Month grid as the workspace, a day rundown on the right with an hour rail | Adopt. The rail turns a list into a schedule |
| Selecting a day repaints the panel instead of opening anything | Adopt. This is the core of the model |
| Event creation in a floating modal over the grid | Reject. It contradicts the goal of rarely needing a modal; creation belongs in the panel |
| Attendee avatars on every event card | Reject. LFHQ events have no attendees; do not invent them |
| Every day is a raised card with a large numeral | Reject. Blackout draws the grid with hairlines; the numeral is metadata, the events are the content |
| Colour-coded event categories | Reject. Types are typography plus three marks (brass, accent, neutral) |
| "Meet link" chip on the card | Adopt as a pattern: `location` renders as a link chip when it is a URL |
| Panel header carrying its own date and prev/next | Reject. Two navigation systems on one screen; the panel follows the grid, never the reverse |

---

## A. Information architecture

### A.1 The grid

The grid answers "what is on, and when". It carries:

- Day numeral (mono 11, muted; today in accent/light; days outside the month at 50%).
- Up to 3 event rows per day cell in month view: 2 px type mark, time in mono 10 (or "All day"),
  title 12 truncated. A fourth line reads "+2 more" and selects the day.
- Week view: the existing time grid, event blocks with the same mark, title, and time.
- Selection state of exactly one day, and highlight state of at most one event.
- Nothing else. No descriptions, no locations, no reminder icons, no avatars.

### A.2 The contextual panel

The panel answers "tell me about this". It has four modes and one identity: it is the right
column of the calendar workspace, on the same canvas, separated by one hairline, never a drawer
sliding in from off-screen.

| Mode | Shows |
| --- | --- |
| Day schedule | Selected date as an eyebrow plus a title, event count, "New event" action, hour-rail rundown of the day's events |
| Event detail | Type, title, when (with duration), timezone if it differs from the viewer's, location, description, reminder, creator, actions (Edit, Delete) |
| Edit | The same fields as a form, Save / Discard |
| Create | The same form, prefilled with the selected day and a sensible start time, Create / Cancel |

### A.3 What stays visible after selecting an event

- The grid, unchanged, with the selected day still selected and the selected event's row
  highlighted. The user never loses their place in the month.
- In the panel: a breadcrumb line above the detail, "Thu 11 Sep · 3 events", which is the
  way back to the day schedule.
- The toolbar (month, view switcher, prev/next). Navigating the month while an event is open
  keeps the event open; the grid highlight simply disappears if the event leaves the window.

### A.4 Progressive disclosure

| Immediately | On demand |
| --- | --- |
| Title, type, time, duration | Description beyond 3 lines (a "More" link expands in place) |
| Location as a chip | Reminder, creator, created/updated timestamps: a quiet "Details" group at the bottom of the detail panel, collapsed on mobile |
| Edit and Delete for people allowed to | Delete confirmation (inline, not a dialog) |
| Timezone only when it differs from the viewer's | The event's stored zone when it matches (shown in the collapsed details group) |

---

## B. Interaction model

### B.1 States

The workspace has one grid state and one panel state. They are independent but linked by the
selected day.

```
GridState
  view:      'month' | 'week'
  anchor:    DayKey           the month or week being shown
  selected:  DayKey           exactly one, defaults to today
  focused:   DayKey           keyboard roving focus, follows selected unless the user arrows away
  highlight: EventId | null   cross-highlight from the panel (hover) or the open event

PanelState
  { mode: 'day' }
  { mode: 'event',  eventId }
  { mode: 'edit',   eventId, dirty }
  { mode: 'create', draft: { day, start?, end?, allDay? }, dirty }
```

The day view of today's app is retired on desktop and tablet; the panel *is* the day. It remains
as the stacked day screen on mobile (§E).

### B.2 Transitions

| From | Trigger | To | Notes |
| --- | --- | --- | --- |
| any | click a day cell, or arrow to it and press Enter/Space | selected = day; panel → day | If the panel was in edit or create with `dirty`, the panel asks first (§B.3) |
| any | click an event row in the grid | selected = event's day; panel → event | One click. Selecting the day is implied |
| day | click an event in the rundown | event | |
| day | click "New event" | create, draft.day = selected | Start time defaults to the next whole hour after now if selected is today, otherwise 19:00 in the org's default timezone |
| day | click an empty hour slot on the rail (desktop only) | create, draft.start = that hour, end = +1 h | The slot shows a "+" ghost on hover |
| event | click Edit, or press E | edit | Only for users `use-can-edit-event` allows |
| event | click Delete, or press Delete/Backspace | event, with the inline confirm strip open | Not a mode change; a sub-state of `event` |
| event | breadcrumb click, Esc, or Backspace with nothing focused | day | |
| edit | Save | event | Optimistic: the detail shows the new values immediately, the row in the grid updates in the same frame |
| edit | Discard, Esc | event | If `dirty`, Discard asks inline; Esc does the same |
| create | Create | event (the new one) | The new row appears in the grid and is highlighted for 600 ms |
| create | Cancel, Esc | day | If `dirty`, asks inline |
| any | prev / next / today / view switch | same panel mode, new anchor | The panel never resets on navigation |
| any | realtime delete of the open event | day, with a toast "This event was deleted by AGER" | Never leave the user looking at a ghost |
| any | realtime update of the open event | event refreshed; if in edit, a strip "Updated by AGER just now · Reload" appears above the form and the form keeps the user's typing | |

### B.3 Dirty-state guard

Leaving `edit` or `create` while `dirty` never opens a modal. The panel footer swaps to a two-line
strip: "Discard your changes to *Scrim vs Onyx*?" with Keep editing (secondary) and Discard
(danger text). The day click that triggered the guard is remembered and replayed on Discard.
Browser navigation away from `/calendar` uses the router's blocker with the same wording.

### B.4 URL

The state above is addressable. Search params are the source of truth for everything that
survives a reload:

```
/calendar?view=month&date=2026-09-11
/calendar?view=month&date=2026-09-11&event=8f1c…
/calendar?view=month&date=2026-09-11&event=8f1c…&mode=edit
/calendar?view=month&date=2026-09-11&mode=new
```

`focused`, `highlight`, `dirty` and the draft's contents are local. Sharing a link to an event
opens it in the panel with its day selected.

---

## C. Motion system

Inherits the Blackout durations and easings. Nothing here exceeds 220 ms except the two
non-interaction fades (realtime flash, new-event highlight), which are notifications rather than
responses.

```
ease        cubic-bezier(.2, 0, 0, 1)
ease-exit   cubic-bezier(.4, 0, 1, 1)
press 80 · hover 120 · select 160 · layout 220
```

| Motion | Duration | Opacity | Translate | Scale | Notes |
| --- | --- | --- | --- | --- | --- |
| Day hover | 120 in / 120 out | — | — | — | Background to `surface/hover` |
| Day select | 120 | — | — | — | Background to `surface/active`, numeral to `text/primary`. The 1 px accent inset border is instant |
| Event row hover | 120 | — | — | — | Background band only |
| Event row select | 120 | — | — | — | Band to `surface/active`; the type mark grows from 2 px to 3 px wide in 120 |
| Panel content change, deeper (day → event → edit) | exit 80, enter 120 | 1→0, 0→1 | exit −4 px x, enter from +6 px x → 0 | — | Content slides *in from the right* by 6 px. Header and footer of the panel do not move; only the body crossfades |
| Panel content change, back (event → day) | exit 80, enter 120 | same | exit +4 px, enter from −6 px | — | Mirror of deeper |
| Panel content change, lateral (day → create) | exit 80, enter 120 | same | enter from +4 px y | — | Vertical because create is a new thing on the same day, not a deeper level |
| Rundown rows on day change | enter 120 each | 0→1 | 4 px y → 0 | — | Stagger 16 ms, max 6 rows staggered, rows beyond 6 appear with the sixth. Total ≤ 220 |
| Month / week navigation | exit 80, enter 160 | 1→0, 0→1 | exit ∓8 px x, enter ±8 px x → 0 | — | Direction follows the arrow: next slides content leftward. The weekday header row and toolbar do not move. No per-cell stagger |
| "Today" jump | 160 | crossfade | — | — | No direction; it is a teleport, not a step |
| View switch month ↔ week | exit 80, enter 160 | crossfade | — | — | No translate; the shapes differ too much for a slide to read |
| New event appears in grid (after create) | 600 hold, 300 fade | — | — | — | Row background `accent/tint`, then fades to rest. Not a loop |
| Realtime change to a visible event | 120 in, 600 hold, 300 fade | — | — | — | Row gets a 1 px `accent/light` left mark and `accent/tint` band, then fades. Not a loop |
| Inline confirm strip (delete, discard) | 160 | 0→1 | 4 px y → 0 | — | Footer height animates 160 with the strip |
| Skeleton | 1.6 s loop | — | — | — | System shimmer |
| Focus ring | 0 | — | — | — | Instant, always |

Rules:

- Transforms never exceed 8 px. Scale is not used anywhere in the calendar.
- One thing animates at a time. A panel crossfade and a month slide never run together; if the
  user navigates during a crossfade, the crossfade is cut and the slide runs.
- Nothing glows persistently. The only glow is the focus ring.
- `prefers-reduced-motion`: all translates become 0, all enters become 80 ms opacity, exits become
  instant, the stagger becomes 0, the two hold-and-fade highlights become a 2 s static tint.

---

## D. Micro-interactions

| Interaction | Behaviour |
| --- | --- |
| Date hover | Cell background `surface/hover` in 120. Cursor pointer. On desktop, a `+` ghost (16 px, `text/muted`) appears top-right of the cell after 200 ms hover; clicking it opens create for that day without changing the panel first. No hover on touch |
| Date selection | Cell background `surface/active`, 1 px inset `accent/light` border, numeral `text/primary`. Previous selection clears in the same frame. Panel body crossfades to the day schedule (§C). The grid does not scroll |
| Event hover (grid) | Row band `surface/hover`. The matching row in the panel rundown, if visible, gets the same band (cross-highlight). Tooltip after 400 ms with full title and time when the title is truncated |
| Event hover (panel) | Row band. The matching row in the grid gets the same band. Nothing else |
| Event selection | Band to `surface/active`, mark 2→3 px. Panel → event detail. Focus moves to the detail heading (§F) |
| New event | "New event" is a primary sm button in the day-schedule header. Panel → create. Title field focused. Type defaults to the last type the user created, else `scrim`. Timezone defaults to the org default. Reminder defaults to none |
| Edit | Secondary sm button in the detail footer, keyboard E. Panel → edit with the form prefilled. Title field focused with its text selected. Footer: Discard (ghost) and Save (primary, disabled until `dirty`) |
| Delete | Danger text button in the detail footer, keyboard Delete. Footer swaps to the confirm strip: "Delete *Scrim vs Onyx*? This cannot be undone." with Cancel (ghost) and Delete (danger solid). Focus moves to Cancel. Confirm removes the event optimistically, panel → day, toast "Deleted · Undo" for 6 s. Undo re-creates it and reopens it |
| Back | Breadcrumb line at the top of detail/edit/create ("← Thu 11 Sep · 3 events"), Esc, or Backspace when no input is focused. Panel → day. Focus returns to the grid cell of the selected day |
| Month navigation | Prev/next icon buttons and ←/→ when the grid has focus. Content slides per §C. Selected day is preserved if it is inside the new window, otherwise it moves to the same day-of-month (clamped) so the panel always has a real day. "Today" button appears in the toolbar whenever today is outside the window |
| Empty day | Panel shows the hour rail with no cards, a single line "Nothing scheduled" in `text/muted` at the rail's top, and the "New event" button. No mascot: an empty day is normal, not an empty state |
| Empty month | Grid shows all cells with no rows; the day panel behaves as above. Still no mascot |
| Loading (first) | Grid: skeleton cells (existing `CalendarSkeleton`). Panel: header with the date and three skeleton rows. Route bar at the top of the content area |
| Loading (navigation) | Previous month stays visible; a 2 px route bar runs across the top of the grid; new data slides in when ready. Never blank the grid between months |
| Loading (save) | Save button locks width, shows the 14 px spinner, label stays. Form fields stay editable-looking but are `aria-disabled`. Panel does not crossfade until the mutation resolves; on failure the button re-enables and an error line appears above the footer |
| Realtime event update | Row highlight per §C. If the open event changed and the user is in detail, the values update in place with the same highlight on the changed fields. If the user is in edit, the strip "Updated by AGER just now · Reload form" appears; their typing is kept |
| Realtime event insert | Row appears in the grid and the rundown with the highlight. Rundown rows below it move down with a 160 ms layout transition |
| Realtime event delete | Row leaves with an 80 ms fade; if it was open, panel → day and a toast names who deleted it |
| Offline / failed mutation | Error line in the panel footer in `danger`: "Couldn't save. Check your connection and try again." The form keeps its values. The realtime hook's reconnect uses the system's route-bar treatment |

---

## E. Responsive behaviour

Breakpoints follow the app: ≥ 1280 desktop wide, 1024–1279 desktop, 768–1023 tablet, < 768
mobile.

### Desktop (≥ 1024)

```
┌ toolbar ───────────────────────────────────────────────┬ panel ───────────────┐
│ September 2026 ▾   [Month | Week]   ‹ Today ›   [New]  │ THU 11 SEPTEMBER      │
├────────────────────────────────────────────────────────┤ 3 events   [New event]│
│ grid, fluid                                            │──────────────────────│
│                                                        │ 09:00 ┃ ▎Scrim vs Onyx│
│                                                        │       ┃  09:00–11:00  │
│                                                        │ 13:00 ┃ ▎Team review  │
│                                                        │ 19:00 ┃ ▎Match · LFG  │
│                                                        │       ┃  vs Kraken    │
└────────────────────────────────────────────────────────┴──────────────────────┘
```

- Panel width 360 at ≥ 1280, 320 at 1024–1279. Fixed, not resizable. One hairline on its left.
  Same canvas colour as the grid; the panel header and footer are `surface`.
- The panel is always present. There is no collapsed state on desktop; the day schedule is the
  resting content.
- The toolbar's "New" (primary, md) creates on the selected day; the panel's "New event"
  (primary, sm) does the same. Both exist because the toolbar is where people look first and the
  panel is where they are when they decide.

### Tablet (768–1023)

- Panel narrows to 288 and its header stacks (date on one line, count and action on the next).
- The hour rail loses its hour labels; rows carry the time instead.
- Month cells show 2 event rows instead of 3.
- Everything else is identical. No collapsing: a tablet in landscape is a desktop.
- Portrait tablet (< 900 wide in portrait) uses the mobile model.

### Mobile (< 768)

The grid and the panel cannot share the width, so the panel becomes a bottom sheet with three
snap points, and the grid stays underneath.

```
peek   96 px   selected date eyebrow, event count, "New event". Always visible above the tab bar
half   50 %    the day rundown; the grid above scrolls to keep the selected week visible
full   100 %   event detail, edit, create. Header gains a back chevron; the grid is hidden
```

- Selecting a day: sheet at peek or half stays where it is and repaints. It does not jump.
- Selecting an event (from the grid or the rundown): sheet → full, content crossfades to detail.
- Back from detail: sheet → half, content → day schedule.
- New event / Edit: sheet → full. The keyboard pushes the sheet's body, not its header.
- Dismiss gesture (drag down) from full acts as Back; from half goes to peek; from peek does
  nothing. While `dirty`, drag-down from full opens the inline discard strip instead of moving.
- Month navigation is a horizontal swipe on the grid plus the toolbar arrows. The swipe uses the
  same 8 px slide; the gesture follows the finger up to 24 px then commits.
- The week view is replaced by a day view on mobile: the view switcher reads Month | Day, and
  Day is the existing time grid for the selected date with the sheet at peek.
- Cross-highlight hover does not exist; selection still does.

---

## F. Accessibility

### Keyboard

| Key | In grid | In panel |
| --- | --- | --- |
| ← → ↑ ↓ | Move focus one day / one week (roving tabindex, one tab stop for the grid) | Tab order only |
| Home / End | First / last day of the focused week | — |
| PageUp / PageDown | Previous / next month (week in week view); focus stays on the same day-of-month | — |
| Shift+PageUp / PageDown | Previous / next year | — |
| T | Jump to today | — |
| Enter / Space | Select the focused day; if the day is already selected, move focus into the panel | Activate |
| Tab | Leaves the grid to the panel | Cycles through panel controls |
| Esc | Clears event highlight | Back one level; with `dirty`, opens the discard strip |
| E | — | Edit, from detail |
| Delete / Backspace | — | Delete, from detail (opens the confirm strip) |
| Ctrl/⌘ + Enter | — | Save / Create, from a form |
| N | New event on the selected day, from anywhere in the workspace when no input has focus | |

Event rows inside a day cell are their own tab stops after the cell, so a keyboard user can reach
"Scrim vs Onyx" without opening the day first.

### Focus behaviour

- Selecting a day by mouse does not move focus out of the grid.
- Opening an event moves focus to the detail's heading (`tabindex="-1"`), so the next Tab lands
  on the first action.
- Entering edit or create focuses the Title field.
- Saving returns focus to the detail heading. Creating focuses the new event's detail heading.
- Deleting returns focus to the grid cell of the selected day.
- Back returns focus to whatever opened the level: the grid row for an event opened from the
  grid, the rundown row for one opened from the panel.
- Mobile: the sheet at full is a focus trap; at half and peek it is not.

### Semantics

- Grid: `role="grid"`, `aria-label="September 2026"`, rows `role="row"`, cells
  `role="gridcell"` with `aria-selected` on the selected day and `aria-current="date"` on today.
  Each cell's accessible name is the full date plus the count: "Thursday 11 September, 3
  events".
- Event rows in cells and in the rundown: buttons with the accessible name "Scrim vs Onyx, 9:00
  to 11:00, scrim". The open event's row carries `aria-current="true"`.
- Panel: `<aside aria-labelledby>` with a visually present heading per mode ("Thursday 11
  September", "Scrim vs Onyx", "Edit Scrim vs Onyx", "New event on Thursday 11 September").
- Live region: one polite `aria-live` node in the workspace. It announces, in order and only when
  they change: "Thursday 11 September, 3 events" on day selection; "Scrim vs Onyx opened" on
  event selection; "Saved", "Created", "Deleted. Undo available" after mutations; "September
  2026" after month navigation; "AGER updated Scrim vs Onyx" on a realtime change to the open
  event. Row highlights and hovers announce nothing.
- The inline confirm strip is `role="alertdialog"`-free: it is plain content with focus moved to
  Cancel, because it does not block the page.
- Colour is never the only carrier: type is written on every row, selection has a border,
  today has `aria-current`.

### Reduced motion

Per §C. Additionally the mobile sheet snaps without animation and the swipe commits on release
without follow-through.

---

## G. Performance

| Motion | Technique |
| --- | --- |
| Hover, selection, mark growth, focus | CSS transitions on `background-color`, `border-color`, `width`. No JS |
| Skeleton shimmer, route bar sweep | CSS keyframes, `transform` only |
| Realtime and new-event highlights | CSS class toggled by React, transition on `background-color`; removed on `transitionend` |
| Panel crossfade with exit, month slide with exit | `motion/react` (the Motion library, `AnimatePresence mode="wait"`, exit 80 + enter 120/160). React cannot animate an unmounting element without it. Only `opacity` and `transform` are animated |
| Rundown stagger | `motion/react` variants with `staggerChildren: 0.016`, capped by rendering rows beyond six without the variant |
| Rundown layout shift on realtime insert | `motion/react` `layout` on rows, 160 ms. Transform-based |
| Mobile sheet drag and snap | `motion/react` drag with `dragConstraints` and snap on release. Transform-based, runs off the main thread where the browser allows |
| Inline strip height | CSS `grid-template-rows: 0fr → 1fr` transition, 160 ms. No JS measurement |

Not used:

- GSAP. Nothing here needs a timeline; every motion is a single enter/exit pair.
- WebGL / Three.js. There is no benefit; the calendar is text on a grid.
- `View Transitions API`. Tempting for the month slide, but browser support on the Tauri
  WebView and Safari is uneven and its exit control is weaker than `AnimatePresence`.

Budget: the Motion library adds roughly 18 kB gzipped, or 6 kB with the `m` component and
`LazyMotion` loading only `domAnimation`. Use the lazy form. Everything animatable by CSS alone
stays CSS so the dependency stays small in scope.

Rendering: the month grid renders 42 cells and up to 126 rows; memoise cells by day key and event
list identity, and keep `highlight` out of the cell props (apply it through a data attribute on
the workspace root and a CSS selector) so hovering in the panel does not re-render the grid.

---

## H. Implementation blueprint

### H.1 Components

```
CalendarWorkspace                      route element, owns URL ↔ state sync and the live region
├── CalendarToolbar                    month title + picker, view switcher, ‹ Today ›, New
├── CalendarGrid                       role="grid", roving focus, keyboard map
│   ├── MonthGrid                      42 cells
│   │   └── DayCell                    numeral, up to N EventChip, "+n more", hover "+"
│   │       └── EventChip              2 px mark, time, title; button
│   └── WeekGrid                       existing TimeGrid, reused
│       └── EventBlock
├── CalendarContextPanel               <aside>, header + body + footer, AnimatePresence around body
│   ├── PanelHeader                    breadcrumb / date / title per mode
│   ├── DaySchedulePanel               hour rail, RundownRow list, empty line, New event
│   │   └── RundownRow                 mark, title, time range, location chip; button
│   ├── EventDetailPanel               fields, Details group, footer with Edit / Delete
│   │   └── ConfirmStrip               inline delete / discard confirmation
│   ├── EventFormPanel                 shared by edit and create; wraps existing EventFormFields
│   │   └── RealtimeUpdateStrip        "Updated by … · Reload form"
│   └── PanelSkeleton
├── MobileContextSheet                 < 768 only; hosts the same four panel bodies at 3 snaps
└── CalendarLiveRegion                 single aria-live node
```

Existing pieces that survive: `EventFormFields`, `event-form.ts` schema and defaults,
`calendar-time.ts`, `event-collisions.ts`, `calendar-layout.ts`, `use-calendar-events`,
`use-calendar-realtime`, `use-can-edit-event`, `TimeGrid`, `EventRow` (becomes `RundownRow` or
`EventChip`), `CalendarSkeleton`. Retired: `EventDetailDialog`, `CreateEventDialog`,
`EditEventDialog`, `DeleteEventDialog`, and the day view on desktop.

### H.2 State

One reducer, colocated with `CalendarWorkspace`, with the URL as the persisted subset.

```
type View = 'month' | 'week'                       // 'day' only on mobile

type PanelState =
  | { mode: 'day' }
  | { mode: 'event';  eventId: string }
  | { mode: 'edit';   eventId: string; dirty: boolean }
  | { mode: 'create'; draft: DraftSeed; dirty: boolean }

type DraftSeed = { day: DayKey; start?: string; end?: string; allDay?: boolean }

type Pending =                                     // what the dirty guard is holding
  | null
  | { kind: 'select-day'; day: DayKey }
  | { kind: 'open-event'; eventId: string }
  | { kind: 'back' }
  | { kind: 'navigate-away'; proceed: () => void }

type WorkspaceState = {
  view: View
  anchor: DayKey
  selected: DayKey
  focused: DayKey
  highlight: string | null                         // event id, hover cross-highlight
  panel: PanelState
  pending: Pending
  confirmingDelete: boolean                        // sub-state of panel.mode === 'event'
  sheet: 'peek' | 'half' | 'full'                  // mobile only
}

type Action =
  | { type: 'SELECT_DAY'; day: DayKey }
  | { type: 'FOCUS_DAY'; day: DayKey }
  | { type: 'OPEN_EVENT'; eventId: string; day: DayKey; from: 'grid' | 'panel' }
  | { type: 'BACK' }
  | { type: 'START_EDIT' }
  | { type: 'START_CREATE'; seed?: Partial<DraftSeed> }
  | { type: 'SET_DIRTY'; dirty: boolean }
  | { type: 'SAVED'; eventId: string }             // edit → event, create → event(new id)
  | { type: 'CANCEL_FORM' }                        // respects dirty via pending
  | { type: 'CONFIRM_DELETE'; open: boolean }
  | { type: 'DELETED' }
  | { type: 'GUARD_KEEP' } | { type: 'GUARD_DISCARD' }
  | { type: 'NAVIGATE'; direction: -1 | 1 } | { type: 'TODAY' } | { type: 'SET_VIEW'; view: View }
  | { type: 'HIGHLIGHT'; eventId: string | null }
  | { type: 'REALTIME_DELETED'; eventId: string }
  | { type: 'SHEET'; snap: 'peek' | 'half' | 'full' }
```

Guard rule inside the reducer: `SELECT_DAY`, `OPEN_EVENT`, `BACK` and `CANCEL_FORM` while
`panel.dirty` set `pending` instead of transitioning; `GUARD_DISCARD` clears `dirty`, applies
`pending`, then clears it; `GUARD_KEEP` clears `pending` only.

Derived, not stored: the events of the selected day (from the query cache), whether the open
event is editable (`use-can-edit-event`), the panel heading text, the live-region message
(computed from the previous and next state in an effect, so it is announced once per change).

### H.3 URL sync

- `view`, `date` (= selected), `event`, `mode` (`edit` | `new`) are read on mount into the
  reducer and written back with `replace` on every change to those four. `anchor` is derived
  from `date` on mount and thereafter navigates independently; it is not in the URL.
- A URL with an `event` that is not in the loaded window fetches that single event, selects its
  day and moves the anchor to it.
- A URL with `mode=edit` for an event the user cannot edit opens detail instead.

### H.4 Data flow for mutations

- Create and edit use the existing service calls through React Query mutations with optimistic
  updates to the calendar family for the current window; the realtime hook's invalidation
  reconciles a moment later.
- Delete is optimistic with a 6 s undo toast; the network delete fires immediately and undo
  re-creates (the id changes; the panel reopens the re-created event).
- The `dirty` flag is `form.formState.isDirty` from react-hook-form, reported upward with
  `SET_DIRTY` on change.

### H.5 Order of work

1. Reducer, URL sync, live region, and the panel shell with `mode: 'day'` only. Dialogs still
   handle detail/create/edit. Ship.
2. Detail in the panel, retire `EventDetailDialog`. Ship.
3. Edit and create in the panel with the dirty guard, retire the two form dialogs. Ship.
4. Inline delete confirm with undo, retire `DeleteEventDialog`. Ship.
5. Motion layer: `LazyMotion`, panel crossfade, month slide, stagger, highlights.
6. Mobile sheet and the mobile day view.
7. Cross-highlight and hover "+" affordances.

Each step leaves the calendar fully usable.

---

## Appendix — Decisions taken here so the developer does not have to

- The panel is permanent on desktop; there is no toggle to hide it.
- The desktop day view is gone; the panel is the day.
- Creation and editing never use a modal. Deletion and discard confirmations are inline strips.
- Two "New" buttons: toolbar and panel. Both act on the selected day.
- Month navigation keeps the panel's mode and the open event.
- The URL carries view, date, event and mode. Nothing else.
- Attendees, colour-coded types, per-panel date navigation and mascots in empty days are all
  explicitly out.
- Motion library: `motion/react` in lazy form, for exits, stagger, layout and the sheet. All
  hover and selection motion stays in CSS.
