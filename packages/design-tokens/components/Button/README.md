# Button

Buttons trigger an action; the accent-filled primary marks the one thing this view exists to do.

## Variants
- `primary` — `accent` fill, `on-accent` text. One per view (per sheet on mobile). Approve, Submit, Start day, Place order.
- `secondary` — `surface` with a `border-strong` outline. Reject, Cancel, Add photo, Retry.
- `ghost` — text in `accent-subtle-fg`, `accent-subtle` on hover. Low-stakes inline actions: Copy previous, View route.
- `danger` — `danger-solid` with `on-danger`. Only for destructive and audited actions (Reset device, Sign out everywhere) and always behind a confirmation that names the consequence.

## Sizes
- `sm` (`control-sm`, 32) — table rows and toolbars on web only.
- default follows density: `control-md` (40) compact, `control-lg` (48) comfortable.
- `lg` — forces 48 with `label-lg`; every mobile button.

## The consumer provides
A verb-first sentence-case label resolved through i18n and terminology (`term.punch_in` → "Start day"); an optional leading icon (Lucide, 20 px); a disabled reason shown nearby, never only a disabled button.

## Don't
- Two primaries side by side; make one secondary.
- Colour a button with a status token to mean "approve" — use `primary`. Reject is `secondary`; it is not destructive.
- Icon-only buttons without an accessible label; on mobile pad them to `touch-min`.
