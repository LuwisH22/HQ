# LFHQ Chat Room — Bubble and Message Motion Audit

Design/UX prototype only. No production code changed.
Prototype: `docs/design/prototypes/chat.html` (also published as an artifact).
Visual source of truth: `LFHQ-VISUAL-DESIGN-SYSTEM-V2.md` (Blackout).

---

## 1. Why the bubble fits Blackout

Blackout draws depth as a tonal step plus a hairline, never as a shadow or a
colour field. A message bubble is exactly that device applied to a paragraph:
`surface` (#14141C) on `canvas` (#0C0C12) with a 1 px `border` (#262633). It is
the same L1 card the dashboard and the calendar panel already use, at 8 px
radius instead of 6 because it wraps prose rather than controls.

The current user's message is one step sideways, not one step up:
`surface/active` (#1B1930) with the accent at 25% on the edge. That is the
tint the system already uses for "selected" and "mine" (selected nav, own
reactions, mention chips). Ownership therefore reads through the same signal
everywhere, and the accent never fills a shape — the one rule that keeps
Blackout from becoming a purple messaging app.

What was deliberately not done:

- No right-alignment for own messages. Everyone stays in one left column with
  a name and an avatar, because an operations channel is read as a record of
  who said what, not as a two-person exchange. Ownership is the bubble tint.
- No tails, no pill shapes, no per-person colours, no shadows, no gradients.
- No larger avatars or padding than the rest of the app.

## 2. Exact visual hierarchy

| Layer | Treatment |
| --- | --- |
| Canvas | `#0C0C12` |
| Date divider | hairline `border/subtle`, label Geist Mono 11 muted |
| Author line (first in group) | name Geist 13/600 `text/primary`; Owner in brass with a brass badge; timestamp Geist Mono 11 `text/muted`, 8 px after the name |
| Avatar | 36 px tile, radius 6, initials Archivo 600, presence dot 7 px; 32 px on mobile |
| Incoming bubble | `#14141C`, 1 px `#262633`, radius 8, padding 6×10, text Geist 14/22 `#F1F0F7`, max-width 72% (84% on mobile) |
| Own bubble | `#1B1930`, 1 px `rgba(102,86,240,.25)`, otherwise identical |
| Hover | border steps to `border/strong`; own bubble to accent at 40% |
| Mention | `accent/tint` background, `accent/light` text, radius 2 |
| Edited | `(edited)` Geist Mono 10 muted, inline after the text |
| Deleted | no fill, 1 px dashed `border/subtle`, italic 13 muted |
| Reply context | inside the bubble, above the text: 2 px `accent/light` left rule, author 12/500 secondary + time mono, quoted line 12/18 muted, single line, truncated at 48ch |
| Attachments | inside the bubble: images 260 px wide at radius 6 with a mono caption strip on `elevated`; files as 44 px rows on `elevated` with a mono extension tile on canvas — no file-type colours |
| Reactions | beneath the bubble: 22 px chips on `elevated` with hairline, count in mono; own reaction `accent/tint` + accent border at 30% |
| Thread entry | beneath the bubble: 16 px stacked tiles, "n replies" in `accent/light`, last-reply time in mono |
| Actions | on hover or focus-within: an L3 chip at the bubble's top-right (react, reply, thread, edit for own, more) |
| Typing | one 20 px line above the composer, three 4 px dots at 1.2 s |
| Composer | `surface`, hairline, radius 6, min 44 px; border turns `accent/light` on focus (the border is the ring); reply state is a 28 px strip above the field with a 2 px accent rule |

Timestamps: on the author line for the first message of a group; for the
rest, in the avatar gutter in Geist Mono 10, only on hover or keyboard focus.
This keeps a group to one visible timestamp while every message still has one
for anybody who asks.

## 3. Grouping rules

- Consecutive messages from the same person within five minutes form a group.
  A date divider, a different sender, or a gap over five minutes starts a new
  group. This is the rule the production `grouping.ts` already applies.
- The first message carries avatar, name, badge and time. The rest carry
  nothing but the bubble.
- Vertical rhythm: 12 px before a group, 2 px between messages inside it,
  2 px between the author line and its bubble.
- Corners: 8 px everywhere, except the corners that face a sibling in the same
  group, which tighten to 3 px on the left edge (bottom-left of the first,
  both left corners of a middle, top-left of the last). Bubbles keep their own
  edges; nothing is merged into a shared card. That is the whole of the
  first/middle/last distinction and it reads only when you look for it.
- Reactions and thread entries belong to their message and sit under it, so
  a reacted message inside a group still reads as one item.

## 4. Motion rules

All durations sit inside Blackout's 80–220 ms band except the arrival tint,
which is a notification rather than a response.

| Event | Motion |
| --- | --- |
| Own message sent | bubble only: opacity 0→1, scale 0.97→1, translateY 4→0, 160 ms, `cubic-bezier(.2,0,0,1)`. A settle, not a pop-out |
| Message from someone else | bubble only: opacity 0→1, translateX −6→0, 160 ms, same easing |
| Arrival tint | after the entrance: border to `accent/light` at 55% and background to `#181826`, held ~40% of 600 ms, then eased back. One cycle, never a loop |
| Hover states | background and border colour, 120 ms |
| Reaction added | none beyond the chip's hover transition (the chip appears in place) |
| Typing dots | 1.2 s loop, 2 px travel, opacity 0.25↔0.9; the only loop on screen |

Rules: the entrance animates the bubble, not the row or the avatar, so the
author line does not move; transforms never exceed 4 px vertical, 6 px
horizontal or 3% scale; no easing overshoots; classes are removed after the
animation so a settled message is a plain message.

## 5. Accessibility

- The message list is `role="log"` with `aria-live="polite"` and
  `aria-relevant="additions"`, so new messages are announced without focus
  moving. A separate polite region names the sender for simulated arrivals.
- Each message is an `article` with a name of "author, time" (and "deleted
  message" where it applies), focusable with Tab; `R` on a focused message
  starts a reply in the prototype (the production shortcut set is unchanged).
- Hover-only controls — the action chip and the gutter timestamp — also
  appear on `focus-within`, so keyboard users get the same tools.
- Reactions are toggle buttons with `aria-pressed` and a spoken count.
- Attachments are named by file name and type; the image is a link with a
  caption strip rather than an unlabeled thumbnail.
- Contrast: body text 15.9:1 on the incoming bubble, 14.6:1 on the own
  bubble; metadata 3.5:1 (non-essential); mention text 7.8:1.
- Ownership is not colour alone: the name line says who, and the own bubble's
  tint is accompanied by an Edit action that only own messages have.

## 6. Reduced-motion behaviour

`prefers-reduced-motion: reduce` (or the prototype's toggle):

- Both entrances become an 80 ms opacity fade with no transform.
- The arrival tint becomes a still border tint for 600 ms, then a step back
  to normal — no colour animation.
- Hover transitions drop to 0 ms.
- The typing dots stop moving and sit at 60% opacity.
- Nothing else changes: grouping, tints and state are identical.

## 7. Deviations from Blackout, stated

- **Radius 8** for bubbles. The system's scale is 2/4/6/10/16; 8 is added as
  the prose-container radius because 6 reads as a control and 10 as a dialog
  around a single line of text. Recommend adding `--radius-bubble: 8px` to the
  token sheet rather than treating it as an exception.
- **Own-bubble border** uses the accent at 25% alpha, a value not in the
  sheet (30% is the badge border). 25% is quieter than a badge deliberately;
  it should be recorded as `--mine-border`.
- **Arrival background `#181826`** is a mid-point between `surface` and
  `surface/active`, used only inside the 600 ms tint. It is transient and not
  a token.
- **Group corner radius 3 px** is not on the radius scale; it exists only as
  the inner corner of a grouped bubble.
- Nothing else departs from the system: no new colours, fonts, sizes,
  shadows or easings.

## Mapping to production

The bubble is a class on the existing `MessageRow` body; `MessageBody`,
`ReplyContext`, `MessageAttachments`, `MessageReactions`, `TypingIndicator`
and `Composer` keep their responsibilities and gain Blackout treatment.
Grouping already exists in `grouping.ts`; the corner classes follow from its
first/last flags. Entrance classes can be applied by the realtime hooks on
insert (own vs. other by author id) and removed on `animationend`. The Motion
library is not required for any of this; CSS keyframes cover it, and Motion's
`useReducedMotion` is available where a JS-side decision is needed.
