# Skeleton

A skeleton holds the shape of content that is still loading, so nothing jumps when it arrives.

## Shapes
`chip` for an icon chip, `title` (16 px) for a title, the default (12 px) for a meta line, and `block` for a tile or photo. All are `surface-sunken` with fully rounded ends.

## The consumer provides
The layout it stands in for, and the loading state. The container carries `aria-busy="true"` and a label naming what is loading ("Loading today's plan").

## Rules
- Match the real layout: a title at about 60% and a meta line at about 40% of the row. Show at most three rows.
- Use it only for a first load. Data already on the phone shows at once and refreshes in place.
- The shimmer sweeps once per `duration-loop` with `ease-linear`. It stops on entry-level phones (`data-motion="lite"`), under reduced motion and in Outdoor, leaving a still shape.
- After 10 seconds, add a sentence saying why: "Still loading. The connection is slow." Never a spinner over a whole screen.
