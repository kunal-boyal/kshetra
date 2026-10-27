# StatTile

A stat tile shows one figure with its label and a line under it, an optional bar and icon. KpiTile is the same tile for a metric against its target. ShareBar and StackedBar show how a whole splits.

## Anatomy
- **StatTile:** `ks-kpi ks-stat`, made of:
  - the label in `ks-kpi-label`, with an optional icon chip;
  - the value in `ks-kpi-value`;
  - an optional `ks-bar`;
  - the line under it in `ks-kpi-foot`.
  - `danger`, `success` and `pending` colour the value and the bar.
  - A tile that links lifts on hover.
- **ShareBar:** `ks-share`, segments in the chart series colours `chart-1…8`, sized by value, with labels inside when a part is at least an eighth.
- **StackedBar:** the same in the status `-solid` colours, with a `ks-legend` naming each part and its amount.

## The consumer provides
Formatted figures (lakh and crore short forms only in tiles), the shares, and labels in the reader's language.

## Rules
- A tile has one figure. Two figures are two tiles.
- Colour is never the only signal: the bars list their numbers for screen readers, and StackedBar has its legend.
- No parts, no bar.
