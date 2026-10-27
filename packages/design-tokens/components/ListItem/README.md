# ListItem

A list item is one row of a list: what leads it, a title and a line under it, and what sits at its end. SplitDetail sets a list beside the detail of its chosen row.

## Anatomy
- **List:** `ks-list`, a card of rows.
- **ListItem:** `ks-item`, made of:
  - a lead (avatar, icon chip, rank or status dot);
  - a title in `ks-title`, cut to one line with the full text in a tooltip;
  - a `ks-meta` line;
  - `ks-item-end` for a value, a badge or a time.
  - A row that goes somewhere tints to `surface-sunken` on hover.
  - The chosen row is `accent-subtle`, with a 3 px `accent` edge.
- **SplitDetail:** `ks-split`, the list and the detail at three parts to two. The detail is a raised card that stays in view as the list scrolls. Under 1024 px it stacks below the list.

## The consumer provides
The rows' content, and where each row goes (a link, through the portal's router) or what it does.

## Rules
- One idea per row: who or what, then the figure that matters at the end.
- Numbers at the end use tabular figures.
- The chosen row and the detail change together; the detail says what it shows in its label.
- Outdoor: the chosen row is ringed in `accent`, not tinted.
