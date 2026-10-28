# Button

Buttons trigger an action; the accent-filled primary marks the one thing this view exists to do. Every button has sturdy corners (`radius-md`, as inputs, decision D72), a 600 weight, and scales to 97% when pressed (`duration-instant`).

## Variants
- `primary` — `accent` fill, `on-accent` text. One per view (per sheet on mobile). Approve, Submit, Start day, Place order.
- `tonal` — `accent-subtle` fill with `accent-subtle-fg` text, `accent-soft` on hover and press. The friendly second action beside a primary: Add photo, Add note, View approved.
- `secondary` — `surface` with a `border-strong` outline. Neutral choices: Reject, Cancel, Retry.
- `ghost` — text in `accent-subtle-fg`, `accent-subtle` on hover. Low-stakes inline actions: Copy previous, View route.
- `danger` — `danger-solid` with `on-danger`. Only for destructive and audited actions (Reset device, Sign out everywhere) and always behind a confirmation that names the consequence.

## Sizes
- `sm` (`control-sm`, 32) — table rows and toolbars on web. On the phone `sm` is `control-md` (40), for a button beside others in a row or a card; a screen's own actions stay 48.
- default follows density: `control-md` (40) compact, `control-lg` (48) comfortable.
- `lg` — forces 48 with `label-lg`; every mobile button.

## The consumer provides
A verb-first sentence-case label resolved through i18n and terminology (`term.punch_in` → "Start day"); a leading Lucide icon (20 px) on every mobile primary and tonal button, from the README's icon map; a disabled reason shown nearby, never only a disabled button.

## Don't
- Two primaries side by side; make one secondary.
- Colour a button with a status token to mean "approve" — use `primary`. Reject is `secondary`; it is not destructive.
- Icon-only buttons without an accessible label; on mobile pad them to `touch-min`.
- Two tonal buttons competing with a primary; one tonal at most per group.

In Outdoor a tonal button becomes a 2 px `accent` outline on `surface`, because glare washes out the tint.
