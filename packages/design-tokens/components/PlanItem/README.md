# PlanItem

A plan item row lists one planned visit for today with its order, account, distance and either its status or a Visit button.

## States
`planned` shows the Visit button (primary, `sm` but padded to `touch-min`); `visited` → `info` badge; `completed` → `success`; `missed` → `neutral`; `cancelled` → `neutral` with strike-free label "Cancelled".

## The consumer provides
Sequence from the route, account name, account type name (tenant's own singular), distance from the last fix, status. Rows are `row-comfortable`; long names truncate, statuses never do.
