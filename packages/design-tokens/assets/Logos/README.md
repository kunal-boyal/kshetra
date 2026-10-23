# Logos

Three files carry the product mark (Field, decision D72): a map pin in morning white holding a harvest-gold flame, on a Forest square. Light where your team is. None of them has a wordmark.

| File | What it is | Use it for |
|---|---|---|
| `mark.webp` | the master: a 1500 px square raster with no transparency | 96 px and larger: the app icon, splash screen, sign-in screen, store listings and the vendor console |
| `mark-small.svg` | the same mark on a 48-unit grid | under 96 px: the favicon, app bar and web navigation |
| `notification-glyph.svg` | single ink: the pin in white (#ffffff) with the flame cut out, on transparent, 24-unit grid inside a 20-unit live area | Android's persistent tracking notification (spec M5) and any other single-ink use |

All three use the exact token values: `brand-forest` #1e5a3a, `brand-gold` #e3a72f and `bg` #f3f5f1 for the pin. The master and the phone's icons are rendered from the SVG geometry, so every size is the same drawing.

- **Where it appears:** besides the uses in the table, the mark is the "Product defaults" logo of spec 5.1. Once a tenant uploads its own logo, that logo replaces the mark in the tenant's app bar and on PDFs.
- **Colour:** always Forest and gold, whatever the tenant's accent. Never recolour or outline it, never add shadows or effects, and never place it on an `accent` fill.
- **Grounds:**
  - On Light and Outdoor grounds the square's edge reaches 7.4:1 or more.
  - On Dark grounds the edge drops to about 2.3:1, but the pin still reads at 7.4:1 inside it. Don't add an outline.
  - The gold flame sits on the pin at about 2:1: it adds warmth, and the pin's shape carries the mark at small sizes. Never use the flame alone.
- **Shape:** keep the square full-bleed. iOS and Android apply their own corner masks, so never pre-round it or pad it inside the file.
- **Clear space:** at least a quarter of the mark's width on every side.
- **Sizes:**
  - The flame's side lick fades below about 24 px; the pin and flame still read there.
  - The small version stays legible down to 16 px.
  - Switch between them at 96 px.
- **Notification glyph:**
  - It is white on transparent, so it disappears on a light tile; view it on a dark ground.
  - Android tints it with the notification's colour; set that to Forest, #1e5a3a.
  - Expo's notification icon must be a 96 × 96 all-white PNG with transparency, exported from this SVG.
- **Beside the name:** set "The Lamp" in `heading-md` in `text`, `space-2` from the mark. The mark carries no wordmark, so it survives a rename of the placeholder product name (spec D1).
