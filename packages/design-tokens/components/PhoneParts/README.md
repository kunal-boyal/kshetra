# PhoneParts

The parts a phone screen is built from around its content: the app bar at its head, the action bar or cart bar at its foot, icon buttons with a count, the choosers for a few short options, the code boxes of sign-in, the tinted tiles that start things and the stepper that counts what goes in a cart. `@thelamp/ui-mobile` draws each from the tokens; the web draws none of them.

## Anatomy
- **AppBar:** a 44 px way back (a chevron, named for where it goes), the title in `heading-md` with a `ks-meta` line under it, and one action at its end. A screen at the top of a tab has no way back.
- **ActionBar:** the screen's actions held at its foot on `surface`, with a `border` edge above and the safe area below; buttons side by side.
- **CartBar:** a 56 px `accent` bar, 12 px from the screen's edges, with `shadow-md`: the number of items, the total with its tax note, and the action with a chevron. One press opens the review.
- **IconButton:** an icon alone at 44 px, named for screen readers, with `ks-count` over it while something waits ("99+" past 99, nothing at 0). BottomNav tabs carry the same count.
- **ChipGroup:** one choice among a few short ones as chips that wrap (`ks-chips`): `surface` with a `border-strong` edge, the chosen one filled with `accent`.
- **SegmentedControl:** two to four views of one thing as one bar of equal segments (`ks-seg`); the chosen one lifts onto `surface`.
- **OtpInput:** a one-time code as six boxes 56 px tall on `surface` with a `border-strong` edge, the digits in `heading-md`. The box the next digit goes in is ringed in `accent` with an `accent-subtle` halo; an error rings them all in `danger-solid` and says why under them, keeping the digits. One input lies over the boxes, so the SMS fills it by itself and a screen reader meets one field named by its label.
- **QuantityStepper:** how many of an item, as − · the value · + inside one `border-strong` edge at `radius-md`, 44 px tall: − on `surface`, the value in `label-lg` tabular figures, + on `accent-subtle` with `accent-subtle-fg`. Each end is named for the item ("More NPK 19:19:19"); pressing the value opens an exact entry, such as another unit or a part of one.
- **Tinted tile:** something to start, such as a visit or leave, as a flat card on its hue's wash (`ks-card tint hue-*`, `radius-xl`, no shadow) with its IconChip and a `label-md` name; two across.

## The consumer provides
The title and the line under it, where back goes, the action; the cart's count, total and action in the reader's language; each chooser's choices and the one chosen; the code's label, which names the number it went to, masked; each tile's hue, icon and name; the stepper's value as shown, the names of its ends and value, and what pressing each does.

## Rules
- One app bar a screen, one action bar or cart bar at its foot, never both.
- The way back says where it goes ("Back to the visit"), not just "Back".
- Counts are numbers in their label for screen readers ("Inbox, 3").
- A stepper steps by one in the line's unit; stepping below one takes the line out.
- Chips are for short labels; anything longer is a list of choices (ChoiceGroup).
- A tile shows only when the person may start what it starts, with its module switched on.
- Outdoor: the chosen chip and segment are ringed in `accent` rather than filled; the cart bar keeps its fill; a tinted tile turns `surface` with a `border` edge; the stepper draws its edge 2 px wide.
