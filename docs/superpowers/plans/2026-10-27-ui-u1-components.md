# Stage U1: the web building blocks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** the reusable pieces the prototype composes and the portal never had, in `@thelamp/ui-web`, each documented in the design system, so stages U2 to U12 only compose.

**Architecture:**
- Components render the design system's existing `ks-*` classes. The few looks the prototype drew with inline styles get classes in `bundle.css`:
  - tabs, the segmented pill and filter chips;
  - the split view and the period stepper;
  - share bars, switches, choice cards and chip lists.
- A person's colour and initials are rules in `@thelamp/shared`, so the phone (M1) colours people alike.
- ui-web takes every word as a prop; it has no i18n and no router.

**Tech stack:** React 19, Vitest with jsdom and Testing Library, axe-core in the component tests.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage U1; the prototype copy in `tools/ui-compare/prototype/`.

## Global constraints

- Tokens only: no hex values in components or new CSS rules.
- Text only from props.
- Native elements first: buttons, checkboxes, lists.
- Each component is axe-clean in its unit test.
- The design system changes in both places, read back byte for byte: `packages/design-tokens` and the artifact.
- No screen changes yet. The portal's own `PageHeader`, `Facts` and `ApprovalSteps` become thin users of the new parts, so nothing visible moves in U1.

## Review focus

1. **Long text.** A 40-character name in `Avatar`, `ListItem` and chips truncates with the full text kept for screen readers. Tested in ListItem.
2. **Devanagari initials.** "सुनीता जोशी" gives the first letter of each word, not a broken half of a conjunct. Tested in `initialsOf`.
3. **Keyboard.** Tabs move with arrow keys, Home and End, with one tab in the tab order. Chips, segments and stepper buttons are buttons. Tested in Tabs.
4. **Unknown or empty values.** No count shows no "· 0". A share bar with no parts renders nothing. A period stepper at its min or max disables that side. Tested in each.
5. **Determinism.** One ID gives one hue, in every app and every run. Tested in `avatarHue`.

---

### Task 1: people's initials and colour (shared)

**Files:** create `packages/shared/src/avatars.ts` and `avatars.test.ts`; export from `packages/shared/src/index.ts`.

**Produces:**
- `AVATAR_HUES = ['sky','peach','mint','lilac','butter','rose','sage','sand'] as const`, with `type AvatarHue`.
- `avatarHue(id: string): AvatarHue`: FNV-1a over the ID's UTF-16 units, modulo 8.
- `initialsOf(name: string): string`: the first grapheme of the first and last word (one word: its first grapheme), Latin upper-cased, by `Intl.Segmenter`.
- `RANK_HUES: Record<1 | 2 | 3, AvatarHue> = { 1: 'butter', 2: 'sand', 3: 'sage' }`.
- `shiftPeriod(period: string, by: number): string` for `YYYY-MM` (moved from `targets-page.tsx`, which imports it).

- [ ] Tests:
  - `avatarHue('01a1…')` is stable across calls and covers all 8 hues over 200 generated IDs.
  - `initialsOf('Kavita Deshmukh') === 'KD'`, `initialsOf('sunita') === 'S'`, `initialsOf('सुनीता जोशी') === 'सुजो'` (first graphemes: सु and जो), `initialsOf('  ') === ''`.
  - `shiftPeriod('2026-12', 1) === '2027-01'`, `shiftPeriod('2026-01', -1) === '2025-12'`.
- [ ] Implement, run `pnpm --filter @thelamp/shared test`, commit.

### Task 2: identity — `Avatar`, `RankBadge`

**Files:** `packages/ui-web/src/identity.tsx`, tests in `identity.test.tsx`.

- `Avatar({ name, id, size = 'md', label }: { name: string; id: string; size?: 'sm'|'md'|'lg'|'xl'; label?: boolean })`:
  - renders `span.ks-ico.round.<size>.hue-<avatarHue(id)>` holding `initialsOf(name)`;
  - decorative (`aria-hidden`) unless `label`, then `role="img"` named by `name`.
- `RankBadge({ rank, label }: { rank: number; label: string })`:
  - renders `span.ks-seq` with `hue-<RANK_HUES[rank]>` for ranks 1 to 3 and no hue after;
  - the rank is the text and `label` its accessible name ("Rank 1").
- [ ] Tests:
  - the same ID gives the same hue class twice;
  - decorative by default; named with `label`;
  - rank 2 has `hue-sand`, rank 7 has no hue class;
  - axe clean.

### Task 3: page structure — `PageHeader`, `DescriptionList`, `Section`

**Files:** `packages/ui-web/src/page.tsx`, `page.test.tsx`.

- `PageHeader({ title, meta, intro, back, actions, toolbar })`:
  - `back`, `actions` and `toolbar` are ReactNodes; meta is a one-line `p.ks-meta`, intro a `p.ks-muted max-w-prose`;
  - renders `header.ks-page-head` (new class) with the h1 `heading-xl`, actions at the end, the toolbar on its own row.
- `DescriptionList({ items, align })`: items are `[label, value]` pairs; `align: 'start' | 'end'` gives `dl.ks-dl` (`.end` right-aligns values for amounts).
- `Section({ title, actions, children })`: `section.ks-card`, `h2.heading-md`, actions beside the title.
- The portal's `PageHeader`, `Section` and `Facts` in `apps/web/src/people/shared.tsx` render these, passing a router `Link` as `back`. Their props stay, so no screen changes.
- [ ] Tests:
  - the title is the page's h1;
  - meta and toolbar render only when given;
  - `align="end"` adds the `end` class;
  - axe clean.

### Task 4: choosing — `FilterChips`, `SegmentedControl`, `Tabs`

**Files:** `packages/ui-web/src/choosers.tsx`, `choosers.test.tsx`.

- `type Choice<T extends string> = { value: T; label: string; count?: number }`.
- `FilterChips<T>({ label, choices, value, onChange, formatCount })`:
  - `div.ks-chips[role=group][aria-label]` of `button.ks-btn.sm`, `primary` when `aria-pressed`, else `secondary`;
  - a count shows as "· 24" through `formatCount`, so numbers follow the locale;
  - `value: T | null`; pressing the pressed chip again calls `onChange(null)` only when the `clearable` prop is set.
- `SegmentedControl<T>({ label, choices, value, onChange })`: `div.ks-seg[role=group]` of `button[aria-pressed]`, which never clears.
- `Tabs<T>({ label, choices, value, onChange, formatCount, idPrefix })`:
  - `div.ks-tablist[role=tablist]` of `button[role=tab][aria-selected][aria-controls=<idPrefix>-panel]`;
  - roving tabindex; ArrowLeft and ArrowRight wrap; Home and End;
  - `tabPanelProps(idPrefix)` gives the panel's `id`, `role` and `aria-labelledby`.
- [ ] Tests:
  - clicking a chip calls `onChange`;
  - the pressed chip has `aria-pressed=true`;
  - a count renders through `formatCount`, and no count shows no separator;
  - ArrowRight on the last tab selects the first;
  - only the selected tab has `tabIndex=0`;
  - axe clean on all three.

### Task 5: rows and layout — `List`, `ListItem`, `SplitDetail`, `DataTable` additions

**Files:** `packages/ui-web/src/lists.tsx`, `lists.test.tsx`; modify `data.tsx`.

- `List({ label, children })`: `ul.ks-list[aria-label]`.
- `ListItem({ lead, title, meta, trailing, selected, href, onClick, as })`:
  - renders `li > .ks-item` (`a` when `href`, `button` when `onClick`, else `div`); `as` lets the portal pass its router Link;
  - the title is `ks-title`, truncated, with the full text in `title=`;
  - `selected` adds `aria-current="true"` and the new `.ks-item.sel`.
- `SplitDetail({ list, detail, detailLabel })`:
  - `div.ks-split` (new: a 3fr–2fr grid, one column under `--bp-lg`);
  - the detail is an `aside[aria-label]` card, sticky below the app bar;
  - `detail = null` gives the list full width.
- `DataTable` gains:
  - `selectedKey?: string`, which adds `tr.sel` and `aria-selected`;
  - `Column.align` gains `'num'` (tabular, left-aligned, for codes and phones);
  - `stickyFirst?: boolean`, through the new `.ks-table.sticky-first`.
- [ ] Tests:
  - a long title has a `title` attribute and the class that truncates;
  - `href` renders a link and `onClick` a button;
  - `selectedKey` marks one row;
  - `SplitDetail` without detail has no aside;
  - axe clean.

### Task 6: measures — `StatTile`, `ShareBar`, `StackedBar`, `PeriodStepper`, `Steps`

**Files:** `packages/ui-web/src/measures.tsx`, `measures.test.tsx`; `KpiTile` stays as it is.

- `StatTile({ label, value, sub, meter, tone, icon, hue, href, as })`:
  - `div.ks-kpi` with an optional icon chip, the value in a tone colour, and `sub` as `.ks-kpi-foot`;
  - `meter` is 0 to 1, drawn as `.ks-bar > i.done`, with the meter's tone;
  - the whole tile is a link when `href` (the portal passes `as`).
- `ShareBar({ label, parts, showLabels = true })`:
  - `parts` are `{ label: string; value: number }[]`;
  - draws `div.ks-share[role=img][aria-label=label]` with segments `flex: value`, in series colours `--chart-1…8`, labels inside segments wide enough;
  - a visually hidden list gives the same numbers, so it isn't colour alone.
- `StackedBar({ label, parts })`: the same, with `parts[i].tone` in `success | pending | waiting | info | danger | neutral` coloured by `--<tone>-solid`, and a legend `ul.ks-legend`.
- `PeriodStepper({ value, onChange, format, label, previousLabel, nextLabel, min, max })`:
  - `div.ks-period[role=group]`: a previous button, an `output` with `format(value)`, a next button, using `shiftPeriod`;
  - min and max disable their side.
- `Steps({ label, steps })`:
  - each step is `{ state: 'done' | 'current' | 'rejected' | 'todo'; title: string; meta?: string }`;
  - draws `ol.ks-steps` with a check node on done, a cross on rejected, and muted text on to-do;
  - `ApprovalSteps` in the portal maps to it.
- [ ] Tests:
  - the meter is clamped to 0–1 in width;
  - ShareBar's segments follow the values and its hidden list holds every part;
  - no parts renders nothing;
  - the stepper at max disables next, and previous calls `onChange('2026-09')` from `'2026-10'`;
  - a rejected step has the cross;
  - axe clean.

### Task 7: settings and tags — `SwitchRow`, `ChoiceCard`, `ChipList`

**Files:** `packages/ui-web/src/settings-parts.tsx`, `settings-parts.test.tsx`.

- `SwitchRow({ label, description, checked, onChange, disabled })`: `label.ks-switch-row` holding the text and an `input[type=checkbox][role=switch].ks-switch` (new: a track and thumb drawn from tokens, focus ring, Outdoor border).
- `ChoiceCard({ title, description, icon, hue, pressed, onClick, children })`: `button.ks-card.ks-choice[aria-pressed]` (new: an accent ring when pressed, hue tint when given).
- `ChipList({ label, items, onRemove, removeLabel, add })`:
  - `ul.ks-chiplist[aria-label]` of neutral `ks-badge` chips;
  - each has a remove button named by `removeLabel(item)` when `onRemove` is given;
  - `add` is a ReactNode at the end.
- [ ] Tests:
  - the switch toggles through `onChange` and is named by its label;
  - a pressed card has `aria-pressed=true`;
  - remove calls `onRemove` with the item;
  - axe clean.

### Task 8: the design system, in both places

**Files:**
- `packages/design-tokens/components/bundle.css`: the new classes above, all from tokens, each with its Outdoor rule (2 px edges where the theme needs them) and reduced-motion-safe transitions;
- `components/<Name>/README.md` and `preview.html` for Avatar (with RankBadge), PageHeader, Choosers (FilterChips, SegmentedControl, Tabs), ListItem (with List and SplitDetail), StatTile (with ShareBar, StackedBar), PeriodStepper, Steps, and SettingsParts (SwitchRow, ChoiceCard, ChipList);
- `README.md` › Intentional additions gains one line.

Then:
- [ ] Preview each card with Playwright, as for the Picker.
- [ ] Publish to the artifact: `project/` paths plus `design-system.json`'s `lastChange`.
- [ ] Read back and `cmp`.

### Task 9: finish

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`; the portal's unit tests unchanged and green.
- [ ] `pnpm --filter @thelamp/ui-compare compare` on Home, to confirm nothing moved.
- [ ] docs/progress.md row.
- [ ] Pull request, Auto-fix, `pnpm verify`, the D92 comment, then wait for Kunal's word.
