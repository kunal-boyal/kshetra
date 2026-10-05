# Platforms and packaging

One token source feeds three apps and two rendering engines. Tokens live in their own package, so mobile can consume them without pulling in web code.

## Packages

| Package | Contents | Consumed by |
|---|---|---|
| `packages/design-tokens` | this design system: `tokens.json` (the source) with generated `tokens.css`, `tokens.ts` and `echarts-theme.json`, plus the brand book, component guides and reference `bundle.css` | everything |
| `packages/ui-web` | shadcn/ui components restyled on the tokens, plus web-only patterns (data table, review card, live map panel) | `apps/web`, `apps/console` |
| `packages/ui-mobile` | React Native primitives (Button, Badge, Field, Sheet, ListRow) plus field patterns (shift card, sync banner, plan item, photo strip) | `apps/mobile` |

Spec §9.4 lists all three packages. The design system lives in `packages/design-tokens`, and decision D17 in `docs/decisions.md` records the move.

## Web (React, Tailwind, shadcn/ui)

- Tailwind's theme reads CSS variables only: `colors.primary = 'var(--accent)'`, `colors.background = 'var(--bg)'`, `colors.card = 'var(--surface)'`, `colors.muted = 'var(--surface-sunken)'`, `colors.destructive = 'var(--danger-solid)'`, `borderRadius.lg = 'var(--radius-lg)'`, and so on. No hex values in component code. Lint for them.
- shadcn/ui components are copied in and restyled once. `Badge` gains the six status variants; `Button` gains the sizes `sm`, `md` and `lg` mapped to the control tokens.
- Charts use Apache ECharts with a generated theme: categorical colours `chart-1` to `chart-8` for lines and outlines, with bars and areas filled in the matching pastel `-fill`, axis and grid `chart-grid`, labels in `text-muted` at `caption`, and tabular numbers in tooltips.
- Maps use the Google Maps JavaScript API with a cloud map style in warm neutrals, so markers in status colours stand out. Markers are SVG built from the map tokens. Outdoor gets its own higher-contrast map style: darker roads and labels, no terrain shading.
- Motion uses CSS transitions and keyframes on the duration and easing variables (`transition: background-color var(--duration-fast) var(--ease-standard)`), as `bundle.css` does. Tailwind maps `transitionDuration` and `transitionTimingFunction` to the same variables. `prefers-reduced-motion` and `data-motion` on `<html>` gate them.
- Icons come from `lucide-react` through one `Icon` wrapper in `ui-web`, so size and stroke follow the icon tokens (1.75 px, 2 px under 16 px). Icon chips are a `ui-web` component over the pastel tokens.
- Themes switch by setting `data-theme` on `<html>`. Outdoor's structural rules (thicker outlines, framed selection, inverted banners) live beside each component in `ui-web` under `[data-theme="outdoor"]`, as in this system's `bundle.css`.

## Mobile (Expo, React Native)

- `tokens.ts` exports `{ light, dark, outdoor }` colour objects, plus spacing, radius, type and size objects, `duration` in milliseconds and `easing` as cubic-bezier control points. Shadows translate to `elevation` on Android and `shadow*` on iOS. Outdoor's rings become a `borderWidth` on the floating view.
- The theme provider exposes `theme.name`, so `ui-mobile` components apply Outdoor's structural rules (2 px outlines, framed selection, inverted sync banner) the same way the web CSS does.
- Type uses the system Noto Sans on Android and loads Noto Sans with Devanagari through `expo-font` on iOS. `allowFontScaling` stays on, and layouts are tested at the largest system size.
- Numbers use `fontVariant: ['tabular-nums']`.
- Motion runs on the UI thread with Reanimated: `withTiming(value, { duration: duration.base, easing: Easing.bezier(...easing.enter) })`, and springs for gestures and sheets (`withSpring`, damping 20, stiffness 220). Reduced motion follows `AccessibilityInfo.isReduceMotionEnabled()`. Android Go, or 3 GB of RAM or less (`expo-device`), turns on lite motion, which stops the loops.
- Icons come from `lucide-react-native` with the same stroke widths. `ui-mobile` provides the icon chip as a primitive.
- Hit areas use `hitSlop` to reach `touch-min` (44) for icons under 44 px.
- Maps use `react-native-maps` with the same style JSON as web.

## Generating

One build step (Style Dictionary or a small script in `tools/`) reads `tokens.json` and writes the CSS, TypeScript and ECharts outputs. CI fails in any of these cases:
- a generated file is stale
- a colour pair named in a usage note drops under its contrast floor (7:1 for text in Outdoor)
- a token is missing a value in any of the three themes

## Versioning

- Tokens follow semantic versioning:
  - **Patch:** a value nudge.
  - **Minor:** a new token.
  - **Major:** a rename or removal.
- Renames ship with an alias for one minor version. Mobile reads the token version from the config bundle, so a JavaScript update over EAS Update and a token change never disagree.
