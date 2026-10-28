# Stage M3: plan, visit and forms — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The phone's tabs, Plan, visit and form screens read as the prototype's `PhoneTabs`, `AppPlan`, `AppVisit` and `AppForm`: the prototype's five tabs; the day's plan as a map and numbered stops with their states, a day either side; an account's screen as the visit there, with what to do on it and a check-out held at its foot; a form under a compact bar that says when its draft was kept, with short choices as chips, photos as tiles and Submit held at its foot.

**Architecture:** No API change: phones already keep plan items from yesterday to the end of next month. `Screen` gains a `footer` for the held actions; the tab set changes in `(tabs)/_layout.tsx`; Accounts and Forms leave the tabs for screens of their own at the same paths; Today's route folds into Plan.

**Spec:** `docs/superpowers/plans/2026-10-27-ui-revamp.md` § Stage M3 and decision 2 (D104: the prototype's tabs); the prototype's `PhoneTabs.dc.html`, `AppPlan.dc.html`, `AppVisit.dc.html` and `AppForm.dc.html`.

## Global constraints

- Tabs, in order: Home, Plan (`visit.use`), Orders (the orders module and `order.create`), Team (as today), More (always). Accounts and Forms stay at `/accounts` and `/forms`, reached from Home's tiles and from More's "My work".
- Plan's days are yesterday, today and tomorrow on the tenant's clock; its title is the tenant's `{term.journey_plan}`. Stops keep route order (`useTodayPlan()`'s), numbered as Home numbers them.
- A stop's state: Done (completed), In review (visited), Missed, Next (today's first planned), Planned.
- The map's line and "n stops · km" join the placed stops in order, straight; it says nothing when no stop has a place, and the list says the same as the map.
- The visit screen keeps everything the account screen showed today: the check-in rules (geofence, plan item, add to today), forms, orders and prices, what the account owes, the location proposal, people and contacts.
- Check out is held at the screen's foot only during the visit there; Submit only on a draft.
- Short choices (single select with up to 8 options of its own, not from the catalogue) are chips; longer lists stay as they are.
- Nothing the person types is lost: the form still keeps its draft 400 ms after a change and before the screen goes.

## Review focus

1. **No plan on a day.** Plan says so for that day, without a map. Tested.
2. **No stop with a place.** The list shows, the map doesn't. Tested.
3. **A visit somewhere else.** The account's screen says where, and offers no check-out here. Tested.
4. **A submitted form.** No footer; the waiting or sent badge shows. Tested.
5. **Hindi at 390 px.** Tabs, day choices, stop rows and the form's bar fit without clipping. Checked in the browser.

---

### Task 1: tabs and More

- `(tabs)`: `index`, `plan`, `orders`, `team`, `me` (titled More); `accounts` and `forms` move to `(app)/accounts/index.tsx` and `(app)/forms/index.tsx` with an `AppBar` back. Icons: House, CalendarCheck, ShoppingCart, Users, LayoutGrid.
- Orders tab: the person's orders from the `orders` sync entity and those waiting to upload, newest first, each with its account, total and status badge; "Take an order" opens Accounts.
- More: "My work" rows for Accounts and Forms above what Me shows today.
- [x] Tests: the tabs by permission and module; the orders list and its empty state; More's rows.

### Task 2: Plan

- `PlanScreen` at `(tabs)/plan.tsx`: title and, when months are approved (`journeyPlanApproval`) and the day has stops, an Approved badge; the day as a `SegmentedControl`; the map with the "n stops · km" badge; stop rows (`SeqBadge`, name, type and purpose, state badge) opening the account; "Add an unplanned visit" opening Accounts. `useTodayPlan()` becomes `usePlanDay(date)`; Today's route screen and `/today-route` go, and Home's link opens Plan.
- [x] Tests: the day switch, states and numbering, no stops, no places.

### Task 3: the visit

- `AccountScreen`: an `AppBar` (back to the plan, "Stop n of m" when today's plan has the account, else the account type); the account's chip, name, "type · code · territory", its distance from the phone's fix against the geofence and its location state; the map; the check-in card (live: "Checked in at", "On this visit for", In progress); "On this visit" rows (the visit's forms, marked Sent once sent from this visit, since forms have no required-on-a-visit setting; other linked forms; a new order; prices); a details list (contact, assigned); then the rest as before. Check out in the `Screen` footer during the visit.
- [x] Tests: stop n of m; checked in shows the live card and the footer; a visit elsewhere has neither.

### Task 4: the form

- `FormEntryScreen`: an `AppBar` with a close that keeps the draft, the form's name, "Draft saved on this phone · time" (or its sent or waiting state) and the version badge; short choices as `ChipGroup`; photo fields and the form's own photos as `PhotoStrip` with the dashed add tile; Submit and the offline note in the footer, Discard below the fields.
- [x] Tests: chips for a short choice, the draft time and version, photos as tiles, no footer once submitted.

### Task 5: finish

- [x] Phone pairs in `tools/ui-compare` (Plan, visit, form) at 390 px with a fresh fixtures person; Hindi at 390 px; the gallery; the progress row; Maestro flows updated for the moved tabs; the pull request and `pnpm verify`.
