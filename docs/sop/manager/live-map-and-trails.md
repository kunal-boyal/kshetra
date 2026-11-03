# Follow the team on the live map

| | |
|---|---|
| **Who** | Manager, Business head, Admin (`live_map.view`; `trail.view` for a person's day) |
| **Where** | Web portal › **Live map**; a person's page › **Day replay**; phone › **Team** › **On duty** |
| **Module** | Core |
| **Related** | [Plan a person's month](journey-plans.md), [Read the attendance register](attendance.md) |

The live map shows who in your scope is on duty now, where each was last seen, and whether they are at a visit or away from today's plan. A person's day replays their route, visits, pauses and gaps. People appear only between the start and end of their day (**Start day** and **End day**; Punch in and Punch out in the agri template): nothing is tracked off duty.

## Before you start

- Maps need a Google Maps key. Without one the portal shows **Maps need a Google Maps key. The lists here still work.**: every list and table on these pages still works. An admin may give the organisation's own key in Settings › **Rules** › **Maps** (**Your Google Maps key for the web**).
- Positions come from people's phones while they are on duty. A phone without signal sends its points later, so a person can look stale and then catch up.

## Steps

### See who is on duty

1. Open **Live map** in the left rail. It reads again every 30 seconds and shows only people on duty.
2. Under **Map view**, **Live** is chosen. The map shows each person's last position; the key on the map explains the colours: **Moving or at a visit**, **Off today’s journey plan** (the tenant's word), **No signal for 15 min, or paused**.
3. Beside the map, **… on duty** counts them, with **… moving**, **… off the plan** and **… no signal**.
4. The list, **People on duty**, gives for each person: **At …** (the account they are visiting), **Moving · last at …**, **Last seen near …**, **Paused** or **No location yet**; how long ago they were last seen; and **visit … of …** against today's plan.
5. With `trail.view`, choose a person in the list to open their day.

### Replay a person's day

1. On **Live map**, choose **Day replay** under **Map view**, choose a **Person** (**Choose someone on duty**), then **Open their day**. Or, from a person's page under **People**, choose **Day replay**.
2. Change **Date** for another day.
3. The page sums the day: shifts, kilometres and visits. The map draws the route and the visits.
4. Move the slider to see **Where they were at …**; the map marks **Here at this time**.
5. Below, each shift shows **Shift … to …**, **… km travelled**, **No location from … to …** for gaps and **Paused from … to …** for pauses, then the day's **Visits**.

For older days only the simplified route is kept, without times; the page says so.

### See where visits happened, and the accounts

1. Under **Map view**, choose **Visit density**: where the team's visits happened this month, on a grid of about a kilometre. **Month** changes the month. **The busiest places this month** lists the grid's busiest cells.
2. Choose **Account pins** (the tenant's word for accounts) to see accounts, **Visited this month** or **Not visited yet**.

### On the phone

1. Open the **Team** tab, then **On duty**. A small map shows **Map of the people on duty**, and the list beneath gives, for each person, **Seen … minutes ago** or **No location yet**, **Not seen for 15 minutes**, **Paused** and **At …**.
2. With `trail.view`, choose a person to open their day: the route, **Shift … to …**, **… km travelled**, gaps, pauses and **Visits**. **Previous day** and **Next day** move between days.

The phone reads these online; without a signal it shows **Try again**.

## What the system checks

- A person is stale after 15 minutes without a position (`isStale()`, `LIVE_STALE_MINUTES`).
- Someone is off today's plan when they are farther than ten geofence radii from every account planned for them today (`offPlan()`, decision D104).
- Points the server refuses (inaccurate, mocked, outside a shift) never reach the map (BR-36).
- Raw points are kept for the organisation's raw retention; after that a day keeps only its simplified route (BR-41).
- You see only people in your scope.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Nobody on duty | Nobody in your scope has started their day. | Check again later, or look at the attendance register. |
| Not seen for 15 minutes | The phone hasn't sent a position for 15 minutes: no signal, battery saving, or tracking paused. | Wait; points sent late fill in the day. If it lasts, call the person. |
| No location from … to … | A gap in the day's points. | Ask the person to open **Keep your route recorded** on their phone, which checks the phone's location and battery settings. |
| Nothing that day | No shift started on that date. | Choose another date. |
| Maps need a Google Maps key. The lists here still work. | No maps key is set. | Use the lists, or ask your admin to add a key. |
| This is outside the people and places you look after. | The person isn't in your scope. | Ask their manager. |

## Waiting on the owner

- Maps before the pilot: the production origin on the vendor's web key, a budget alert, and the Firebase and Android key settings for phone builds. Until then the portal may show the maps notice.
