# Choosers

Three ways to choose among a few options.

## Anatomy
- **FilterChips:** a row of `ks-btn sm` toggles narrowing a list. The chosen one is `primary` with `aria-pressed`, the rest `secondary`. A count follows as "· 14".
- **SegmentedControl:** `ks-seg`, a pill on `surface-sunken`. The chosen view is a raised `surface` segment.
- **Tabs:** `ks-tablist`, underlined tabs with a 3 px `accent` rule under the chosen one, and counts as in the chips.

## The consumer provides
The options, with counts the API gives (never counted from one page of a list), the chosen value, and a locale formatter for the counts.

## Rules
- Chips filter a list; one choice at a time unless the page says otherwise. A clearable chip clears on a second press.
- Segments switch views of the same thing (Live, Day replay, Density); one is always chosen.
- Tabs switch panels:
  - only the chosen tab is in the tab order;
  - the arrow keys, Home and End move between tabs;
  - the panel is named by its tab.
- No count, no "· 0". Counts use tabular figures.
- Outdoor: the chosen segment is ringed in `accent`, and the chosen tab is bold.
