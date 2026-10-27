# KpiTile

A KPI tile shows one metric's approved actual against its locked target, with pending value shown apart and never added in.

## Anatomy
Head: a small IconChip in the metric's hue and the label (metric name, resolved per language) · actual in `metric-xl` · progress bar on a fully rounded track: approved in `accent`, pending in `pending-solid` stacked after it · foot: attainment % of target, and "+N pending" in `pending-fg`.

## Motion
On the first view in a session, the actual counts up and the bar fills over `duration-celebrate`; after that, a refreshed figure changes in place. Reduced motion shows the final figure at once.

## The consumer provides
Metric name, icon and hue, approved actual, pending value, target (or none), unit and locale formatter. Attainment is computed server-side.

## Rules
- Only approved work counts; pending is never inside the main number.
- No target → "No target set" and an empty bar; never 0%.
- Draft (unlocked) targets add a `pending` badge "Draft target".
- A tile that leads to the metric's detail is a link (`a.ks-kpi`, or `ks-kpi act` on the router's link): its border firms and its shadow lifts on hover.
- On mobile, tiles go two-up at 360 dp; values never wrap — shorten with lakh/crore suffixes (₹8.4 L) only in tiles, full figures elsewhere.
