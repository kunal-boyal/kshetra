The Lamp is the shared design language for a multi-tenant field-force product: one Android-first mobile app, one tenant web portal and one vendor console, rebranded per tenant at runtime and used in Hindi, English and regional languages. Tenants supply the accent colour and the vocabulary. The system supplies everything else: neutrals, a pastel palette, fixed status colours, honest labels, a type scale that holds Devanagari, density modes for phone and desk, sturdy shapes, icons and calm motion, and an Outdoor theme for work in direct sun.

The look is **Field** (decision D72): forest green and harvest gold from the farms and markets field teams work in, on neutrals with a faint green bias, set in Mukta, with a map pin that holds a flame for a mark. The name is the idea: a lamp shows what was in the dark, here the work a manager can't see.

## Principles

1. **Status is a word first, a colour second.** Every status renders its label (`Approved`, `Pending`, `Rejected`) next to its colour. Colour is a scanning aid and never the only signal.
2. **Labels say exactly what a figure is.** Provisional, indicative, dated snapshot and request are distinctions a reader needs. Never drop them to save space; shorten the surrounding copy instead.
3. **The tenant owns the accent and nothing else.** Brand colour flows only into the `accent` tokens. Status colours, neutrals and data-viz colours are the same for every tenant, so a reviewer moving between tenants reads them the same way.
4. **Built for the worst phone in the field.** Design at 360 dp, with large text, in sunlight, on a 4 GB Android phone, offline. Check every screen in the Outdoor theme as well as Light. Desktop is the easy case.
5. **Configuration before components.** Industry words (beat, outlet, MR, liquidation) never appear in component copy. Components take resolved strings from the terminology layer.
6. **Soft and friendly, never vague.** Rounded shapes, pastel colours, icons and calm motion make the app easy to approach for someone new to a work app. They never replace a label, a number or a status word, and each gives way in Outdoor and under reduced motion.

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

- **Ground:** use `bg` for the page, `surface` for cards and tables, `surface-sunken` for wells and table headers, and `surface-raised` (always with a shadow token) for menus and sheets. The neutrals carry a faint green bias, like morning light over a field; never blue-grey, never warm stone.
- **Text:** use `text` for content, `text-muted` for help and meta, and `text-subtle` only for placeholders and timestamps. All three pass 4.5:1 on every surface in Light and Dark, and 8:1 in Outdoor.
- **Accent:** `accent` fills the one primary action per view, the selected tab, the active nav item and links. Set text on it in `on-accent`. Use `accent-subtle` with `accent-subtle-fg` for selected rows and chips, and `accent-soft` for the active tab pill and the hover of tonal buttons. The product default is Forest (#1e5a3a). Tenants override it (see Tenant theming).
- **Brand:** `brand-forest` and `brand-gold` are the product's own colours, the same in every theme and for every tenant: the mark, the sign-in panel and nothing else. Text on `brand-forest` is `on-brand`. Gold is never text, never a status and never an accent.
- **Approved is not the accent.** `success` is a fresher, yellower green than Forest, so an approved badge never reads as a button. Keep the two apart: never use `success` tokens for actions or `accent` for an outcome.
- **Pastels:** eight soft hues give each kind of thing an identity at a glance: `sky`, `peach`, `mint`, `lilac`, `butter`, `rose`, `sage` and `sand`, in that order.
  - Each hue has three tokens. `pastel-<hue>-bg` tints a card or a soft chip, `pastel-<hue>-fill` fills icon chips, avatars and chart bars, and `pastel-<hue>-fg` is the ink for icons, initials and text on either.
  - Account types, forms and metrics take hues in their configured order, so a thing keeps its colour on every screen and in every chart. People take a hue from their user ID.
  - A pastel says what kind of thing, never what state. Never use one to mean good, bad or waiting; that is what the status tokens and their words are for.
  - Tint at most one featured card per screen (today's summary on Home, an account's header). Lists, tables and forms stay on `surface`.
  - The palette is product-owned, like the status colours. Tenants recolour only the accent.
- **Status (fixed across tenants):**

| Meaning | Token set | Used for |
|---|---|---|
| Done, good | `success-*` | approved, accepted, present, completed, fulfilled, inside geofence |
| Waiting for the first decision | `pending-*` | pending review, draft targets, queued uploads |
| Waiting at a later step | `waiting-*` | later approval steps, partially accepted, outside geofence (advisory) |
| Planned, informational | `info-*` | planned and visited plan items, notices |
| Refused | `danger-*` | rejected, absent, parked uploads, destructive actions, errors |
| Off | `neutral-*` | cancelled, inactive, missed, auto-closed, discarded |

Each set has four roles: `-fg` for text and icons, `-bg` for badge and banner fills, `-border` for outlines, and `-solid` for dots, markers and progress fills. In Light and Dark, `-border` matches `-bg`, so badges, pills and banners are soft pastel shapes with no edge; in Outdoor it becomes the `-fg` outline. Never set text on `-solid`. The exceptions are destructive buttons and count badges, which pair `danger-solid` with `on-danger`. Amber `pending` and orange `waiting` sit close in hue, so the label always tells them apart.
- **Data viz:** take categorical series from `chart-1` to `chart-8` in order for lines, points and outlines. Fill bars and areas with the matching pastel (`chart-1` with `pastel-sky-fill`, `chart-2` with `pastel-peach-fill`, and so on), outlined at 1.5 px in the series colour. When a series means a status (approved and pending on the daily trend), use the status `-solid` tokens instead. Draw targets as a dashed `chart-target` line and gridlines in `chart-grid`.
- **Maps:** route `map-route`, geofence `map-geofence` (fill at `opacity-geofence`), visit inside `map-inside`, outside `map-outside`, stale users `map-stale` at `opacity-stale` with their last-seen age as text.

### Themes

| Theme | Who sees it | Character |
|---|---|---|
| Light | the default everywhere | warm stone grounds, pastel tints, soft shadows |
| Dark | follows the OS on mobile; a profile setting on web | deep grounds, deep pastel tints with light ink, a lightened accent with dark `on-accent` text |
| Outdoor | chosen by the user for direct sun; offered on web as the high-contrast option | white grounds, near-black text, outlined status and icon chips, drawn edges |

Outdoor is for a phone read in midday sun, where glare washes out pale tints, light grey text and hairlines. In Outdoor:

- **Text:** every text pair reaches 7:1 or more (WCAG AAA). That covers `text`, `text-muted`, `text-subtle`, every status `-fg`, `accent-subtle-fg`, `on-accent` and `on-danger`.
- **Grounds:** `bg`, `surface` and `surface-raised` are white. `surface-sunken` stays a light stone, and text on it still reaches 8:1.
- **Edges:**
  - Borders separate things, never shade alone. `border` reaches 3.9:1 on every ground, and `border-strong` 9.4:1.
  - `shadow-sm` is `none`. `shadow-md` and `shadow-lg` add an ink ring under the shadow.
- **Status:** badges and pills are outlined, never tinted. Every `-bg` is white, and every `-border` aliases its `-fg`.
- **Pastels:** every `pastel-*-bg` is white and every `-fill` nearly so. Icon chips get a 2 px outline in their ink, tinted cards turn white with a `border`, tonal buttons become `accent` outlines, and skeletons stop shimmering.
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

- **One family, two scripts:** Mukta, drawn by Ek Type for Latin and Devanagari together, so English and Hindi share weight, height and rhythm on one line. Both apps bundle its 400, 500, 600 and 700 weights (decision D72): `@fontsource/mukta` on the web, `@expo-google-fonts/mukta` on the phone, Android included. Noto Sans and Noto Sans Devanagari follow in the stack as fallbacks, and Noto's subsets will carry the regional scripts on the roadmap (Gujarati, Bengali, Gurmukhi, Telugu, Tamil, Kannada) when those languages arrive.
- **Weight:** headings 600, figures and the brand 700, body 400, controls 600. Mukta reads lighter than Noto at the same weight, so labels that were 500 are 600.
- **Scale:** `display` → `heading-xl` → `heading-lg` → `heading-md` for structure. Body copy uses `body-lg` on mobile and `body-md` on web. Use `label-*` for controls and badges, and `metric-*` / `numeric` for figures.
- **Figures:** every number uses `font-variant-numeric: tabular-nums`. Right-align numbers in tables. A row's first cell names it (`<th scope="row">`) and reads as body text, with any code beneath in `caption`; totals go in `tfoot`, on `surface-sunken`. A field in a table is `control-sm` high and right-aligned, carries its unit as an affix (`ks-affix` before the value, `ks-affix wide` for a longer prefix such as `+91`, `ks-affix end` after it) and its column heading repeats the unit (`.sub`); an edited, unsaved field takes `changed`.
- **Indic scripts:** under `:lang(hi)` and other Indic locales, add 4 px of line-height to every style. Matras and conjuncts clip otherwise. Never set Indic text below 13 px. `bundle.css` applies both through `--ks-lead` and `--ks-min`, so a component written in Latin stays correct in Hindi. Badges, flags and pills grow taller instead of clipping.
- **Codes and IDs** use `mono`.

### Space, size and density

- **4 px grid:** `space-1` (4) through `space-16` (64). Mobile screen gutters use `space-4`, web page gutters `space-6`.
- **Two densities:** set `data-density` on the root.
  - `comfortable` is the mobile default: `control-lg` (48) controls, `row-comfortable` rows, `body-lg` text.
  - `compact` is the web default: `control-md` (40), `control-sm` (32) in tables, `row-compact` rows, `body-md` text.
- **Touch:** anything tappable on mobile has a hit area of at least `touch-min` (44). Pad small icons out to that size rather than enlarging them.
- **Icon chips:** `iconchip-sm` (32) in tables, `iconchip-md` (40) on rows and tiles, `iconchip-lg` (48) on mobile rows and the form picker, `iconchip-xl` (72) on empty states.

### Shape and depth

- **Sturdy, slightly rounded.** Corners are small and grow with the surface, from `radius-xs` (4 px) to `radius-xl` (16 px); only chips, badges and avatars are pills:

| Radius | Used for |
|---|---|
| `radius-xs` | checkboxes, chart bar ends, photo tags |
| `radius-sm` | menu items, tooltips, 32 px icon chips |
| `radius-md` | buttons, inputs, notices, photo tiles, map boxes, icon chips, navigation items |
| `radius-lg` | cards, KPI tiles, tables, list groups, inset banners, menus |
| `radius-xl` | sheets, dialogs, the bottom tab bar, empty states, tinted cards, 72 px icon chips |
| `radius-full` | badges, chips, pills, avatars, progress tracks, dots |

- Photos and maps inside a card take `radius-md` and sit inside its padding, never against its edge.
- **Soft depth:** surfaces rest on soft, wide shadows with a faint `border` edge, never a hard outline:

| Shadow | Used for |
|---|---|
| `shadow-sm` | cards, KPI tiles, list groups, tables and empty states on `bg` |
| `shadow-md` | the shift card, menus, popovers |
| `shadow-lg` | dialogs, sheets |

- `border-strong` still outlines inputs, checkboxes and secondary buttons, because a control needs a visible edge.
- Layering follows the `zIndex` tokens. The sync banner and bottom tab bar sit at `z-sticky`.

### States

- **Focus:** a 2 px `focus-ring` outline (3 px in Outdoor) with a 2 px offset on every focusable element, following its rounded corners. It never disappears on mouse click for inputs.
- **Hover:** shift fills one step (`accent` → `accent-hover`, `accent-subtle` → `accent-soft`). Pressed is the same as hover on touch devices.
- **Pressed:** buttons, list rows and tappable cards scale to 97% for `duration-instant`, then return.
- **Disabled:** `opacity-disabled` with `text-disabled` labels, and no hover. Always say why nearby: "Start your day to place orders."

### Motion

Motion says what just happened and where things went. Feedback is quick, arrivals are calm and loops are rare.

- **Tokens:** `duration-instant` (90 ms), `duration-fast` (150), `duration-base` (240), `duration-slow` (360), `duration-celebrate` (700) and `duration-loop` (1,600). `ease-standard` for most changes, `ease-enter` for arrivals, `ease-exit` for departures, `ease-spring` for a small overshoot, and `ease-linear` for loops only.
- **Patterns:**

| Moment | What moves | Tokens |
|---|---|---|
| Press | the button, row or card scales to 97% and back | `duration-instant`, `ease-standard` |
| Arrive | fades in and rises `space-2`; list items 40 ms apart, the first six only | `duration-base`, `ease-enter` |
| Leave | fades out and sinks `space-1` | `duration-fast`, `ease-exit` |
| Sheet or dialog | slides up on mobile, or fades and grows from 96% on web, over a fading `scrim` | `duration-slow`, `ease-enter` |
| Switch tab | the active pill grows in; the content crossfades | `duration-base`, `ease-spring` |
| Banner | drops in under the app bar | `duration-base`, `ease-enter` |
| First view of a figure | KPI values count up and progress bars fill, once per session | `duration-celebrate`, `ease-standard` |
| Success | a tick draws itself in a `mint` chip that pops: saved, uploaded, approved | `duration-celebrate`, `ease-spring` |
| Start day | three rings ripple out from the pin, like the logo's geofence | `duration-celebrate`, `ease-exit` |
| Loading | skeletons shimmer | `duration-loop`, `ease-linear` |
| On duty | the live dot pulses | `duration-loop`, `ease-exit` |

- **Rules:**
  - Animate `transform` and `opacity` only, never layout. On mobile, animations run on the UI thread.
  - Motion never blocks input. A tap during an animation acts at once.
  - Count-ups and fills run on the first view in a session. A refreshed figure changes in place, so numbers never dance.
  - At most one loop on screen at a time.
  - Nothing moves under a thumb that is typing. The review queue keeps a 150 ms fade between cards, so reviewers keep their pace.
- **Reduced motion:** when the OS asks, or the app sets `data-motion="reduced"` on the root, every duration becomes instant. Things still appear and change, but nothing counts, fills, pulses, shimmers or ripples.
- **Entry-level phones:** the app sets `data-motion="lite"` on Android Go and on phones with 3 GB of RAM or less. Feedback and arrivals stay; every loop stops, and the tracking indicator never animates.

### Layout

- **Mobile:**
  - Bottom tabs: Home, Plan, Orders (module-gated), Me, and Team for managers.
  - Visit, form and camera screens open full screen above the tabs.
  - The sync banner sits directly under the app bar.
- **Web:**
  - Left navigation at `nav-web` (248 px, collapsing to 64 px below `bp-md`).
  - A header period picker drives every period-based screen.
  - Content caps at `content-max`. Maps and wide tables may run full-bleed.
- **Print (decision D99):**
  - A report, an order or an account statement prints as one sheet (`ks-print-sheet`), always in the Light theme.
  - The sheet opens with a heading (`ks-print-head`): the tenant's legal name, what it is, its period and filters, whose records the reader's role reaches, and when it was printed.
  - The shell, buttons and fields never print. Tables drop their shadow and corners, repeat their header row on each page, and keep each row whole.

## Iconography

- **Lucide** (the icon set shadcn/ui ships with) on web and mobile, via `lucide-react` and `lucide-react-native`: 1.75 px stroke at `icon-md` (20) and `icon-lg` (24), 2 px at `icon-sm` (16), 1.5 px at `icon-xl` (32). Round caps and joins, never filled. The previews here draw simplified outlines in the same style. Products import the real components.
- **Icons wherever people scan:** every tab, navigation item, list row, KPI tile, notification and mobile primary or tonal action carries one. An icon never stands in for a word, except in an icon button with an accessible label.
- Icons inherit `currentColor` from their text token. Status icons use the status `-fg` token and always sit beside the status word.
- **Icon chips** put an icon on its pastel hue (`IconChip`): rounded squares for things, circles with initials for people. Account types and forms carry their own Lucide `icon` in configuration, and the templates set them.
- **Icon map:**

| Area | Icons |
|---|---|
| Navigation | `house` (Home), `calendar-days` (Plan), `shopping-bag` (Orders), `users` (Team), `circle-user-round` (Me), `inbox` (Approvals), `bell` (Notifications), `chart-column` (Performance), `trophy` (Leaderboard), `map` (Live map), `settings` |
| Shift | `play` and `square` (start and end day), `pause` |
| Visits and evidence | `map-pin` (visit), `map-pin-check` (checked in), `target` (geofence), `locate-fixed` (GPS fix), `camera`, `image` (gallery), `pen-line` (signature), `scan-barcode` |
| Work | `clipboard-list` (forms and activities), `route` (journey plan), `goal` (targets), `wallet` (collection), `receipt` (expenses), `calendar-check` (attendance), `calendar-x` (leave), `indian-rupee` (amounts) |
| Sync | `cloud-off` (offline), `cloud-upload` (uploading), `cloud-check` (all sent), `refresh-cw` (retry) |
| Statuses | `check` (approved), `clock` (pending), `hourglass` (waiting at a later step), `x` (rejected), `ban` (cancelled) |
| Flags | `triangle-alert` (advisory), `shield-alert` (integrity), `clock-alert` (clock skew) |

- **Empty states** carry a 72 px icon chip, a sentence and at most one action. No emoji anywhere in the product UI, and no illustrations: icons, colour and shape carry the friendliness.
- **Logo:** the product mark, a map pin holding a harvest-gold flame on a Forest square: light where your team is.
  - At 96 px and larger, use `assets/Logos/mark.webp`. Below that, use `mark-small.svg`.
  - Android's tracking notification uses the white `notification-glyph.svg`: the pin with the flame cut out.
  - The mark is always Forest and gold whatever the tenant's accent, and never sits on an `accent` fill.
  - The tenant's logo replaces it in the app bar and on PDFs.
  - The Logos group's notes hold the full rules.

## Intentional additions

- **IconChip, Skeleton and the Motion card,** added at the owner's request for icons, motion, soft shapes and pastel colours. The screens need them: icons on rows and tiles, a loading state for slow networks, and one reference for every motion pattern.
- **Avatar, PageHeader, Choosers, ListItem, StatTile, PeriodStepper, Steps and SettingsParts,** added for the UI revamp to the approved prototype (phase U, decision D104): the parts the prototype composes its screens from, so the screens show people as people, states as badges, filters as chips and a list beside its detail.
- **Picker, and the chevron on every select,** added at the owner's request: the browser's own arrow sat on a select's edge. A `select.ks-input` draws a chevron in `text-muted` with the field's padding beside it, in every theme, and Picker is the compact choice for a bar, such as language and theme: an icon, the value and that chevron, over a native select.

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
| pastel `-fg` on its `-bg` and `-fill` | ≥ 5.9:1 | ≥ 10:1 |

- Outdoor doubles as the high-contrast theme for low-vision users on web.
- Motion follows reduced motion everywhere, and nothing flashes more than three times a second.
- A badge's accessible name is its label, not its colour. Maps duplicate every coloured marker in the side list as text.
- Layouts must survive 200% text on mobile. Rows grow, they never truncate a status word.
