# KpiTile

A KPI tile shows one metric's approved actual against its locked target, with pending value shown apart and never added in.

## Anatomy
Label (metric name, resolved per language) · actual in `metric-xl` · progress bar: approved in `accent`, pending in `pending-solid` stacked after it · foot: attainment % of target, and "+N pending" in `pending-fg`.

## The consumer provides
Metric name, approved actual, pending value, target (or none), unit and locale formatter. Attainment is computed server-side.

## Rules
- Only approved work counts; pending is never inside the main number.
- No target → "No target set" and an empty bar; never 0%.
- Draft (unlocked) targets add a `pending` badge "Draft target".
- On mobile, tiles go two-up at 360 dp; values never wrap — shorten with lakh/crore suffixes (₹8.4 L) only in tiles, full figures elsewhere.
