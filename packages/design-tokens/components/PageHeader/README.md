# PageHeader

A page header opens every portal and console page. It holds a way back, the title with a one-line summary, the page's actions, and a toolbar row.

## Anatomy
- `ks-page-head`: an optional back link (`ks-btn ghost sm`).
- The title in `heading-xl` (the page's one h1), with the period in it: "Expenses · October".
- A `ks-meta` line summing the page up: "64 claims · ₹1,42,300 · 5 over the policy".
- Actions at the end of the title row.
- `ks-page-toolbar` for filter chips, tabs or a period stepper.
- A page about one person puts their Avatar, size `lg`, before the title, with their designation and territory in the meta line.

## The consumer provides
The title and period, the summary figures, the actions, and the toolbar's controls.

## Rules
- The meta line is facts, not instructions; keep it to one line.
- Put a page's filters in the toolbar as chips. Only fields that need typing get labelled inputs.
- At most one primary action.
