# Stage M1: the phone building blocks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `@thelamp/ui-mobile` has every part the prototype's phone artboards compose, so stages M2 to M6 build screens without drawing their own: rows with a lead, a second line and an end; an app bar; a footer bar and the cart bar; chips and a segmented control; avatars that match the web's; a progress bar; numbered seals; photo tiles; steps; flags; notices with a tone; icon buttons with a count; counts on tabs; and small buttons.

**Architecture:** Components only, in `packages/ui-mobile/src`, each taking everything from the tokens and tested with Jest; the design system gains a PhoneParts card and notes on the cards the phone shares, in the repository and the artifact alike. No screen changes: the app keeps its look until M2.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage M1; the prototype's `App*.dc.html` and `PhoneTabs.dc.html`.

## Global constraints

- Tokens only: colours from the theme, spacing, radii and sizes from `@thelamp/design-tokens`; touch targets at least `touch-min` (44 px); text through `Text`.
- Outdoor: tints become outlines, as the existing parts do (a chosen chip or segment is ringed, a notice and a footer bar gain an edge).
- Accessibility: each part names itself for screen readers in the role it plays (button, radio group, tab, progress bar, image), with counts in its label ("Inbox, 3 new").
- Avatars take their hue and initials from `avatarHue()` and `initialsOf()` in `@thelamp/shared`, as the web does, so a person matches across apps.
- `KpiTile` draws its bar with `ProgressBar`; nothing it shows changes.
- Existing props keep working: `ListRow`, `Notice`, `BottomNav` and `Button` only gain optional ones.

## Review focus

1. **A row with every part and a row with none.** Both read well and keep the 56 px row. Tested.
2. **Counts of 0 and over 99.** No badge at 0; "99+" above. Tested.
3. **A progress bar past 100% or with nothing done.** Clamped; empty bar. Tested.
4. **Outdoor.** Chosen chips and segments are ringed, not tinted. Tested.
5. **Hindi labels.** Chips and segments wrap or shrink rather than clip. Checked in the browser.

---

### Task 1: rows, bars and footers

- `ListRow` gains `lead` (an `IconChip` or `Avatar`), `meta` (a second line), `trailing` (a value or badge), `unread` (a dot) and `highlight` (the accent's tint).
- `AppBar { title, subtitle?, onBack?, backLabel?, action? }`: a 44 px back, the title and subtitle, a trailing action.
- `ActionBar { children }` (a footer on the surface with its edge, above the safe area) and `CartBar { count, total, action, onPress }` (the accent bar).
- [x] Tests: the row's parts and its label; the app bar's back; the cart bar's label and press.

### Task 2: choosers and measures

- `ChipGroup<T> { label, choices, value, onChange }` (single choice, wrapping, a radio group), `SegmentedControl<T>` (the same, as one bar of equal segments).
- `Avatar { name, id, size? }`, `SeqBadge { n, tone? }`, `ProgressBar { parts: { value, tone: 'done' | 'pending' | 'danger' }[], label }`; `KpiTile` uses `ProgressBar`.
- [x] Tests: choosing; the avatar's initials and hue agree with the web's; clamping; the progress bar's label.

### Task 3: photos, steps, flags, notices, buttons, tabs

- `PhotoTile { uri, time?, label }`, `PhotoStrip { photos, onAdd?, addLabel }` with a dashed add tile.
- `Steps { label, steps: { state, title, meta? }[] }` as the web's.
- `Flag { label, tone? }` as `ks-flag`.
- `Notice` gains `tone` (`neutral`, `info`, `pending`, `danger`) and `icon`.
- `IconButton { icon, label, count?, onPress }`; `BottomNav` items gain `count`; `Button` gains `size="sm"` (40 px).
- [x] Tests: the add tile; the steps' states; the notice's tone; counts and "99+".

### Task 4: the design system and finish

- A PhoneParts card (README and preview) for AppBar, ActionBar and CartBar, IconButton, ChipGroup and SegmentedControl on the phone; notes on Avatar, Notice, BottomNav, Button, Steps and FlagChip; the same files in the artifact, read back byte for byte.
- [x] `pnpm --filter @thelamp/mobile test` alone (decision: phone Jest runs on its own), the progress row, the pull request and `pnpm verify`.
