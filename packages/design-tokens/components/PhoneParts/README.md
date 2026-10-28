# PhoneParts

The parts a phone screen is built from around its content: the app bar at its head, the action bar or cart bar at its foot, icon buttons with a count, and the choosers for a few short options. `@thelamp/ui-mobile` draws each from the tokens; the web draws none of them.

## Anatomy
- **AppBar:** a 44 px way back (a chevron, named for where it goes), the title in `heading-md` with a `ks-meta` line under it, and one action at its end. A screen at the top of a tab has no way back.
- **ActionBar:** the screen's actions held at its foot on `surface`, with a `border` edge above and the safe area below; buttons side by side.
- **CartBar:** a 56 px `accent` bar, 12 px from the screen's edges, with `shadow-md`: the number of items, the total with its tax note, and the action with a chevron. One press opens the review.
- **IconButton:** an icon alone at 44 px, named for screen readers, with `ks-count` over it while something waits ("99+" past 99, nothing at 0). BottomNav tabs carry the same count.
- **ChipGroup:** one choice among a few short ones as chips that wrap (`ks-chips`): `surface` with a `border-strong` edge, the chosen one filled with `accent`.
- **SegmentedControl:** two to four views of one thing as one bar of equal segments (`ks-seg`); the chosen one lifts onto `surface`.

## The consumer provides
The title and the line under it, where back goes, the action; the cart's count, total and action in the reader's language; each chooser's choices and the one chosen.

## Rules
- One app bar a screen, one action bar or cart bar at its foot, never both.
- The way back says where it goes ("Back to the visit"), not just "Back".
- Counts are numbers in their label for screen readers ("Inbox, 3").
- Chips are for short labels; anything longer is a list of choices (ChoiceGroup).
- Outdoor: the chosen chip and segment are ringed in `accent` rather than filled; the cart bar keeps its fill.
