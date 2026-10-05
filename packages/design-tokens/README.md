Kshetra is the shared design language for a multi-tenant field-force product: one Android-first mobile app, one tenant web portal and one vendor console, rebranded per tenant at runtime and used in Hindi, English and regional languages. Tenants supply the accent colour and the vocabulary. The system supplies everything else: neutrals, fixed status colours, honest labels, a type scale that holds Devanagari, density modes for phone and desk, and an Outdoor theme for work in direct sun.

## Principles

1. **Status is a word first, a colour second.** Every status renders its label (`Approved`, `Pending`, `Rejected`) next to its colour. Colour is a scanning aid and never the only signal.
2. **Labels say exactly what a figure is.** Provisional, indicative, dated snapshot and request are distinctions a reader needs. Never drop them to save space; shorten the surrounding copy instead.
3. **The tenant owns the accent and nothing else.** Brand colour flows only into the `accent` tokens. Status colours, neutrals and data-viz colours are the same for every tenant, so a reviewer moving between tenants reads them the same way.
4. **Built for the worst phone in the field.** Design at 360 dp, with large text, in sunlight, on a 4 GB Android phone, offline. Check every screen in the Outdoor theme as well as Light. Desktop is the easy case.
5. **Configuration before components.** Industry words (beat, outlet, MR, liquidation) never appear in component copy. Components take resolved strings from the terminology layer.

## Content fundamentals

- **Voice:** plain, exact and calm. Say what happened and what happens next. No exclamation marks, no emoji, no jokes in system messages.
- **Person:** address the user as "you" and refer to the product's actions in the passive or by outcome ("Saved on this phone"), never as "we".
- **Casing:** sentence case everywhere, including buttons, tabs, titles and badges. Codes keep their own case (`ORD-2610-00042`).
- **Terminology:** never hard-code an industry noun. Use the resolver key: `term.account`, `term.field_user`, `term.activity`, `term.journey_plan`, `term.plan_item`, `term.target`, `term.order`, `term.punch_in` / `term.punch_out`. A button reads "Start day" only because `term.punch_in` resolves to it.
- **Numbers:** always the tenant locale with tabular figures. `en-IN` shows ₹1,23,456.00. Dates and times always show in the tenant timezone, written as "30 Sep, 10:42".
- **Empty states** say what happens next and who acts: "Your manager has not set this month's targets yet."
- **Required strings.** These are specified copy, translated but never paraphrased:

| Situation | Copy |
|---|---|
| Offline save | Saved on this phone. It will upload when you are back online. |
| Pending work | Only approved activity counts toward your targets. |
| Orders | This is an order request. Accepting it does not create an invoice, reduce stock or count as sales. |
| Ranking | Indicative ranking. People without locked targets are not ranked. |
| Provisional pay | Attendance-based estimate. This is not a statutory payroll document. |
| Gallery photo | Chosen from the gallery. The time and place shown are when it was attached. |
| Tracking | Location is recorded only while you are on duty. Restarting the phone, force-stopping the app or battery savers can stop recording. |
| Finance snapshot | Figures as of {date} from {source}. This is a dated snapshot, so check the date before relying on it. |
| Locked target | This target is locked and can no longer be changed. |

- **Errors:** every server error code maps to a sentence plus a next step. Write "This price changed since you were offline. Review the new total, then place the order again." Never "Error 409".

## Visual foundations

### Colour

- **Ground:** use `bg` for the page, `surface` for cards and tables, `surface-sunken` for wells and table headers, and `surface-raised` (always with a shadow token) for menus and sheets. The neutrals are warm stone, never blue-grey.
- **Text:** use `text` for content, `text-muted` for help and meta, and `text-subtle` only for placeholders and timestamps. All three pass 4.5:1 on every surface in Light and Dark, and 8:1 in Outdoor.
- **Accent:** `accent` fills the one primary action per view, the selected tab, the active nav item and links. Set text on it in `on-accent`. Use `accent-subtle` with `accent-subtle-fg` for selected rows and chips. The product default is Jamun (#5b2b82). Tenants override it (see Tenant theming).
- **Status (fixed across tenants):**

| Meaning | Token set | Used for |
|---|---|---|
| Done, good | `success-*` | approved, accepted, present, completed, fulfilled, inside geofence |
| Waiting for the first decision | `pending-*` | pending review, draft targets, queued uploads |
| Waiting at a later step | `waiting-*` | later approval steps, partially accepted, outside geofence (advisory) |
| Planned, informational | `info-*` | planned and visited plan items, notices |
| Refused | `danger-*` | rejected, absent, parked uploads, destructive actions, errors |
| Off | `neutral-*` | cancelled, inactive, missed, auto-closed, discarded |

Each set has four roles: `-fg` for text and icons, `-bg` for badge and banner fills, `-border` for outlines, and `-solid` for dots, markers and chart fills. Never set text on `-solid`. The exceptions are destructive buttons and count badges, which pair `danger-solid` with `on-danger`. Amber `pending` and orange `waiting` sit close in hue, so the label always tells them apart.
- **Data viz:** take categorical series from `chart-1` to `chart-8` in order. When a series means a status (approved and pending on the daily trend), use the status `-solid` tokens instead. Draw targets as a dashed `chart-target` line and gridlines in `chart-grid`.
- **Maps:** route `map-route`, geofence `map-geofence` (fill at `opacity-geofence`), visit inside `map-inside`, outside `map-outside`, stale users `map-stale` at `opacity-stale` with their last-seen age as text.

### Themes

| Theme | Who sees it | Character |
|---|---|---|
| Light | the default everywhere | warm stone grounds, tinted status badges |
| Dark | follows the OS on mobile; a profile setting on web | deep grounds, a lightened accent with dark `on-accent` text |
| Outdoor | chosen by the user for direct sun; offered on web as the high-contrast option | white grounds, near-black text, outlined status, drawn edges |

Outdoor is for a phone read in midday sun, where glare washes out pale tints, light grey text and hairlines. In Outdoor:

- **Text:** every text pair reaches 7:1 or more (WCAG AAA). That covers `text`, `text-muted`, `text-subtle`, every status `-fg`, `accent-subtle-fg`, `on-accent` and `on-danger`.
- **Grounds:** `bg`, `surface` and `surface-raised` are white. `surface-sunken` stays a light stone, and text on it still reaches 8:1.
- **Edges:**
  - Borders separate things, never shade alone. `border` reaches 3.9:1 on every ground, and `border-strong` 9.4:1.
  - `shadow-sm` is `none`. `shadow-md` and `shadow-lg` add an ink ring under the shadow.
- **Status:** badges and pills are outlined, never tinted. Every `-bg` is white, and every `-border` aliases its `-fg`.
- **Sync banners invert:** the status `-fg` becomes the fill, with `text-inverse` on it. A banner's job is to be noticed, and a dark band survives glare where a tint does not.
- **Structure,** under `[data-theme="outdoor"]` in `bundle.css`:
  - a 3 px focus ring
  - 2 px outlines on inputs and secondary buttons
  - underlined ghost buttons
  - a border on notices, flag chips, photo tags and progress tracks
  - a 2 px `accent` frame around selected table rows
  - a 2 px `accent` ring on the active bottom tab
- **Charts:** `chart-5` darkens so every series reaches 4.5:1 on white. Gridlines get stronger.

The accent stays the tenant's, darkened only as far as Outdoor's 7:1 rule needs (see Tenant theming). Never switch to Outdoor automatically. The user turns it on and off.

### Type

- **One family, many scripts:** Noto Sans. It covers Latin, Devanagari and every regional script on the roadmap (Gujarati, Bengali, Gurmukhi, Telugu, Tamil, Kannada) with matched metrics, and Android already ships it, so most phones download nothing. Load Latin and Devanagari from Google Fonts on web. Add each script's Noto subset only when that language is enabled.
- **Scale:** `display` → `heading-xl` → `heading-lg` → `heading-md` for structure. Body copy uses `body-lg` on mobile and `body-md` on web. Use `label-*` for controls and badges, and `metric-*` / `numeric` for figures.
- **Figures:** every number uses `font-variant-numeric: tabular-nums`. Right-align numbers in tables.
- **Indic scripts:** under `:lang(hi)` and other Indic locales, add 4 px of line-height to every style. Matras and conjuncts clip otherwise. Never set Indic text below 13 px. `bundle.css` applies both through `--ks-lead` and `--ks-min`, so a component written in Latin stays correct in Hindi. Badges, flags and pills grow taller instead of clipping.
- **Codes and IDs** use `mono`.

### Space, size and density

- **4 px grid:** `space-1` (4) through `space-16` (64). Mobile screen gutters use `space-4`, web page gutters `space-6`.
- **Two densities:** set `data-density` on the root.
  - `comfortable` is the mobile default: `control-lg` (48) controls, `row-comfortable` rows, `body-lg` text.
  - `compact` is the web default: `control-md` (40), `control-sm` (32) in tables, `row-compact` rows, `body-md` text.
- **Touch:** anything tappable on mobile has a hit area of at least `touch-min` (44). Pad small icons out to that size rather than enlarging them.

### Shape and depth

- Corners follow the radius scale:

| Radius | Used for |
|---|---|
| `radius-sm` | badges, chips |
| `radius-md` | controls |
| `radius-lg` | cards and banners |
| `radius-xl` | sheets |
| `radius-full` | pills and dots |

- Borders do most of the separating: `border` hairlines between rows and cards, `border-strong` around inputs. Shadows are reserved for things that float:

| Shadow | Used for |
|---|---|
| `shadow-sm` | tiles on `bg` |
| `shadow-md` | menus |
| `shadow-lg` | dialogs, sheets |

- Layering follows the `zIndex` tokens. The sync banner and bottom tab bar sit at `z-sticky`.

### States and motion

- **Focus:** a 2 px `focus-ring` outline (3 px in Outdoor) with a 2 px offset on every focusable element. It never disappears on mouse click for inputs.
- **Hover:** shift fills one step (`accent` → `accent-hover`). Pressed is the same as hover on touch devices.
- **Disabled:** `opacity-disabled` with `text-disabled` labels, and no hover. Always say why nearby: "Start your day to place orders."
- **Motion:** 120 ms for state changes and 200 ms for sheets and dialogs, ease-out. Nothing moves when `prefers-reduced-motion` is set, and the tracking indicator never animates on entry-level phones.

### Layout

- **Mobile:**
  - Bottom tabs: Home, Plan, Orders (module-gated), Me, and Team for managers.
  - Visit, form and camera screens open full screen above the tabs.
  - The sync banner sits directly under the app bar.
- **Web:**
  - Left navigation at `nav-web` (248 px, collapsing to 64 px below `bp-md`).
  - A header period picker drives every period-based screen.
  - Content caps at `content-max`. Maps and wide tables may run full-bleed.

## Iconography

- **Lucide** (the icon set shadcn/ui ships with) on web and mobile, via `lucide-react` and `lucide-react-native`: 1.75 px stroke at `icon-md` (20), 2 px at `icon-sm` (16). The previews here draw simplified outlines in the same style. Products import the real components.
- Icons inherit `currentColor` from their text token. Status icons use the status `-fg` token and always sit beside the status word.
- **Core glyphs:**

| Meaning | Icons |
|---|---|
| Shift | `play` and `square` (start and end day), `pause` |
| Tracking | `map-pin` |
| Evidence | `camera`, `image` (gallery) |
| Sync | `cloud-off`, `cloud-upload` |
| Flags | `alert-triangle` |
| Statuses | `check` (approved), `clock` (pending), `x` (rejected) |

- No emoji in the product UI, and no illustrations in operational screens. Empty states are a sentence and an action.
- **Logo:** the Kshetra mark, a Jamun square holding three geofence rings and a pin.
  - At 96 px and larger, use `assets/Logos/kshetra-mark.webp`. Below that, use `kshetra-mark-small.svg`.
  - Android's tracking notification uses the white `kshetra-notification-glyph.svg`.
  - The mark is always Jamun whatever the tenant's accent, and never sits on an `accent` fill.
  - The tenant's logo replaces it in the app bar and on PDFs.
  - The Logos group's notes hold the full rules.

## Accessibility

- WCAG 2.1 AA on web, plus dynamic type and screen-reader labels on mobile. Every colour pair in this system was checked in all three themes:

| Pair | Light and Dark | Outdoor |
|---|---|---|
| text on every ground | ≥ 4.5:1 | ≥ 8:1 |
| status `-fg` on `-bg` | ≥ 5.8:1 | ≥ 9.4:1 |
| `on-accent`, `on-danger` on their fills | ≥ 4.5:1 | ≥ 8:1 |
| `-solid` marks, chart series | ≥ 3:1 | ≥ 4.6:1 on white |
| `border-strong` | ≥ 3.1:1 | ≥ 9.4:1 |
| `border` | decorative | ≥ 3.9:1 |

- Outdoor doubles as the high-contrast theme for low-vision users on web.
- A badge's accessible name is its label, not its colour. Maps duplicate every coloured marker in the side list as text.
- Layouts must survive 200% text on mobile. Rows grow, they never truncate a status word.
