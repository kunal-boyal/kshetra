# MenuButton

A menu button opens a small panel under it: the person's choices behind their avatar in the portal's bar, or a few actions behind a button.

## Anatomy
- **Trigger:** a button at least 44 px square holding an avatar or icon, named for screen readers ("Your profile and settings") and carrying `aria-expanded`. On hover the avatar takes an `accent-soft` ring.
- **Panel:** `ks-menu` on `surface-raised` with `radius-lg` and `shadow-lg`, at least 16 rem wide. It drops in over `duration-fast` and is aligned to the trigger's end, or its start.

## The consumer provides
The trigger, the panel's content (links, a picker, a sign-out button) and the trigger's name.

## Rules
- It is a disclosure, not an application menu: the panel holds ordinary links and controls in reading order.
- The panel closes in three ways:
  - Escape, which gives focus back to the trigger;
  - a click outside;
  - any action in the panel.
- In the portal's bar it holds the person's name and role, Sign-in security, the theme and Sign out. The bar keeps the language toggle and the bell.
- Outdoor draws the panel with a 2 px `border-strong` edge.
