# Tenant theming

Hundreds of tenants share one build. A tenant changes exactly three things: the accent palette, the logo and the terminology strings. Everything else is product-owned and identical across tenants.

## Token tiers

| Tier | Example | Who sets it | Where it lives |
|---|---|---|---|
| Semantic | `surface`, `text-muted`, `success-fg`, `space-4` | the design system | `tokens.json` → generated CSS variables and a TypeScript object |
| Tenant | `accent`, `accent-hover`, `accent-subtle`, `accent-soft`, `accent-subtle-fg`, `on-accent` | derived at runtime from the tenant's brand colour | tenant config bundle (`tenant_settings.brand_colour`) |
| Component | `--ks-btn-bg`, `--ks-badge-fg` | components, defaulting to semantic or tenant tokens | `bundle.css` / component styles |

Components read semantic and tenant tokens only, never raw hex. A component that needs a new colour gets a new semantic token, and it is added to every theme at once.

## Deriving the accent from one brand colour

The tenant admin enters one hex. Settings refuses it unless it reaches 4.5:1 against white (spec 5.1), and offers the nearest darker shade that passes. The rest is derived in OKLCH so lightness steps look even across hues:

| Token | Light theme | Dark theme | Outdoor theme |
|---|---|---|---|
| `accent` | the brand colour as entered | L = 0.78, C = min(C, 0.12), same hue | the Light accent, darkened in L only until white text on it reaches 7:1 |
| `accent-hover` | L − 0.06 | L + 0.06 | L − 0.06 |
| `accent-subtle` | L = 0.96, C × 0.15 | L = 0.27, C × 0.35 | same as Light |
| `accent-soft` | L = 0.905, C × 0.32 | L = 0.34, C × 0.41 | L = 0.93, C × 0.25 |
| `accent-subtle-fg` | L = 0.35, same C and hue | L = 0.86, C × 0.6 | L = 0.30, same C and hue |
| `on-accent` | white | L = 0.21, C × 0.4 (dark text) | white |
| `focus-ring` | alias of `accent` | alias of `accent` | alias of `accent` |

After derivation, verify the pairs in every theme:
- `on-accent`/`accent`, `on-accent`/`accent-hover`, `accent-subtle-fg`/`accent-subtle` and `accent-subtle-fg`/`accent-soft`: ≥ 4.5:1 in Light and Dark, ≥ 7:1 in Outdoor.
- `accent` on `surface`: ≥ 3:1.

If a check fails, nudge L until it passes and log the adjustment in the audit entry for the branding change. The product default, Jamun (#5b2b82), already reaches 9.9:1 with white, so its Outdoor accent is unchanged.

**Pastels stay put.** The pastel palette is product-owned, like the status colours, and the brand colour never reaches it. A hue marks a kind of thing inside one tenant's configuration (its first account type is `sky`), so people moving between tenants go by names and icons, not hues.

**Collision guard:** if the brand hue falls within 20° of a status hue (green 145°, amber 80°, orange 55°, blue 255°, red 25°), the accent still applies to buttons and navigation but is never used on its own as an indicator. Selected states add a check icon or weight change, so a green-branded tenant's selected chip is never read as "approved".

## Delivery

- **Web:** the config bundle is fetched at sign-in and the six accent variables are written to `:root`, before first paint, from a cached copy. Tailwind maps `primary` to `var(--accent)` and `primary-foreground` to `var(--on-accent)`, so shadcn/ui components follow the tenant automatically.
- **Mobile:** the derived palette is stored in SQLite with the config bundle and read synchronously at launch, so offline cold starts are already branded. A theme provider exposes it to components. No accent value is ever compiled into the JS bundle.
- **PDFs and exports:** use the accent for the header rule only. Tables stay neutral for print.
- **Console:** the vendor console uses the product default accent, never a tenant's, so staff always know which side they are on. Support-access sessions inside a tenant show a fixed `waiting`-coloured banner ("Support access as …").

## Dense and comfortable

`data-density="compact|comfortable"` on the root swaps control heights, row heights and body size. Web defaults to compact. The mobile app is always comfortable. A web user may choose comfortable in their profile, and the choice persists per user.

## Themes

Three complete themes, set as `data-theme="light|dark|outdoor"` on the root:

- **Light** is primary.
- **Dark** follows the OS on mobile and a profile setting on web.
- **Outdoor** is the high-contrast theme for direct sun. The README's Themes section lists what it changes.

A token missing a value in some theme inherits Light, which is how Outdoor silently loses its contrast. Every token carries all three values, and CI rejects one that doesn't.

Choosing Outdoor:

- **Mobile:** More → Display offers System, Light, Dark and Outdoor. The Home app bar menu holds a one-tap Outdoor switch for the moment someone steps into the sun. The choice is stored per device, not per user, because it depends on where the phone is used.
- **Web:** the profile setting offers Outdoor as "High contrast". It is the same theme.
- **Never automatic.** The app never switches on its own, even where an ambient light sensor exists. A screen that changes under someone's thumb mid-form is worse than glare.
- **Console:** offers Light and Dark only.

Before Outdoor is suggested in onboarding, confirm it in a field test: midday sun, at least two Android brands from the device matrix (spec 14.5), with the punch-in, visit, form and upload-queue flows.
