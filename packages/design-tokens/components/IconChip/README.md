# IconChip

An icon chip shows what kind of thing a row, tile or notification is: its Lucide icon on its pastel hue.

## Sizes
- `sm` (`iconchip-sm`, 32 px, `radius-sm`) — web table rows and dense lists.
- default (`iconchip-md`, 40 px, `radius-md`) — list rows, KPI tiles, notifications.
- `lg` (`iconchip-lg`, 48 px) — mobile list rows and the form picker.
- `xl` (`iconchip-xl`, 72 px, `radius-xl`) — empty states and success moments, with a 32 px icon at 1.5 px stroke.

## Variants
- default — the icon in the hue's `-fg` on its `-fill`.
- `soft` — on the hue's `-bg`, for a quieter chip beside a busier one.
- `round` — a circle, for people: two initials in place of an icon. Things are rounded squares, people are circles.

## The consumer provides
The icon name from configuration (account types and forms carry a Lucide `icon`), and the hue as a `hue-<name>` class on the chip or any ancestor. Account types, forms and metrics take hues in their configured order (sky, peach, mint, lilac, butter, rose, sage, sand); people take one from their user ID, so a colour never changes between screens or devices.

## Rules
- A chip says what kind of thing, never what state. A state is a StatusBadge with its word.
- Always next to a visible name. The icon is `aria-hidden`; a person's chip carries their name as its label.
- In Outdoor the chip turns white with a 2 px outline in its ink, because glare washes out pastel fills.
