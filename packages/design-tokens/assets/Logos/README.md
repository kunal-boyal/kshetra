# Logos

Three files carry the product mark: a Jamun square holding three geofence rings and a pin in `accent-subtle`, the same motif as the cover. None of them has a wordmark.

| File | What it is | Use it for |
|---|---|---|
| `mark.webp` | the master: a 1500 px square raster with no transparency | 96 px and larger: the app icon, splash screen, sign-in screen, store listings and the vendor console |
| `mark-small.svg` | the same mark on a 48-unit grid, with rings at 6% of the width and a larger pin | under 96 px: the favicon, app bar and web navigation |
| `notification-glyph.svg` | single ink: the rings and pin in white (#ffffff) on transparent, 24-unit grid inside a 20-unit live area | Android's persistent tracking notification (spec M5) and any other single-ink use |

The master's purple encodes as #562d7d, a hair off the `accent` default (#5b2b82). The two SVGs use the exact token values, #5b2b82 and #f3edf8.

- **Where it appears:** besides the uses in the table, the mark is the "Product defaults" logo of spec 5.1. Once a tenant uploads its own logo, that logo replaces the mark in the tenant's app bar and on PDFs.
- **Colour:** always Jamun, whatever the tenant's accent. Never recolour or outline it, never add shadows or effects, and never place it on an `accent` fill.
- **Grounds:**
  - On Light and Outdoor grounds the square's edge reaches 9.4:1 or more.
  - On Dark grounds the edge drops to about 1.9:1, but the rings still read at 8.8:1 inside it. Don't add an outline.
- **Shape:** keep the square full-bleed. iOS and Android apply their own corner masks, so never pre-round it or pad it inside the file.
- **Clear space:** at least a quarter of the mark's width on every side.
- **Sizes:**
  - The master's rings are 1% of its width and fade below about 100 px.
  - The small version stays legible down to 16 px.
  - Switch between them at 96 px, and never scale the small version above that; its rings read heavy there.
- **Notification glyph:**
  - It is white on transparent, so it disappears on a light tile; view it on a dark ground.
  - Android tints it with the notification's colour; set that to Jamun, #5b2b82.
  - Expo's notification icon must be a 96 × 96 all-white PNG with transparency, exported from this SVG.
- **Beside the name:** set "The Lamp" in `heading-md` in `text`, `space-2` from the mark. The mark carries no wordmark, so it survives a rename of the placeholder product name (spec D1).
