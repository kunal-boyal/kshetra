# FlagChip

A flag chip names one evidence flag on a submission so a reviewer can weigh it; it never decides anything by itself.

## Variants
- default (`waiting-fg` on `waiting-bg`) — advisory flags: outside geofence (with distance), gallery photo, clock skew.
- `danger` (`danger-fg` on `danger-bg`) — integrity flags: duplicate photo, mock location, device integrity warning.

Both are pastel pills (`radius-full`); in Outdoor they are white with a 1 px outline in their text colour.

## The consumer provides
The flag label with its evidence ("Outside geofence · 640 m"), and a 16 px icon. Flags are listed in a fixed order: integrity first, then location, then photo, then time.

## Rules
- Flagged submissions are excluded from bulk approval; the chip explains why.
- Never hide flags behind a count on review cards; on list rows, show the first flag and "+2".
