# Plan a person's month

| | |
|---|---|
| **Who** | Manager, Business head, Admin (`plan_item.manage` to plan visits and approve months; `route.manage` to keep routes) |
| **Where** | Web portal › **People** › a person › **Plan** |
| **Module** | Core |
| **Related** | [Decide approvals](approvals.md), [Review submissions](review-submissions.md), [Set targets and account plans](targets-and-account-plans.md) |

A person's journey plan (Beat plan in the agri template, Tour plan in pharma, PJP in FMCG) is the month's planned visits (the tenant's word for a plan item), each to one account on one day. You keep their routes, plan the month from them, add or cancel single visits, and, where your organisation asks for it, approve the month. The person sees each day's planned visits on their phone.

## Before you start

- The accounts must be ones the person sees: each planned visit is judged with the person's own access, not yours.
- If your organisation has plans approved (Settings › **Rules** › **Approvals** › **Journey plans need their manager's approval**), a month is sent for approval and approved before it is fixed.
- The person's leave and weekly offs show on the month's calendar, so you can plan around them.

## Steps

### Keep the person's routes

1. Open **People**, choose the person, then **Plan**. The page is headed **… · …** with the person and month.
2. Under **Routes**, choose **Add a route**, or **Edit** beside a route.
3. Give the **Route name** and tick the **Days of the week** it runs.
4. In **Add a account to the route** (the tenant's word for account), choose each account in turn. **Stops, first to last** lists them; use **Move … up**, **Move … down** and **Remove …** to order them. The map shows the route stop by stop.
5. Keep **In use** ticked for a route that should plan visits. A route not in use shows **Switched off**.
6. Choose **Save route**.

### Plan the month

1. Choose the month with **Previous month** and **Next month**.
2. Choose **Plan from routes**. It plans a visit for each account on each day a route in use falls on, from today on, and says how many it planned. Running it again plans nothing twice.
3. To add a single visit, go to **Plan a visit**: choose the account (**Choose a account**), the **Date**, a **Purpose** and any **Instructions** for the person (up to 1,000 characters), then choose **Plan a visit**. It says **Visit planned.**
4. To cancel a visit, choose **Cancel visit** on its row, then confirm **Cancel the visit to … on …?** Only a visit still planned can be cancelled.
5. The calendar shows each day's stops, **Leave**, **Leave asked** and **Weekly off**; the table lists the month's visits by **Date**, account, **Purpose**, **On the route** and **Status**.

### Send the month and approve it

Only where plans are approved.

1. The badge beside the heading says where the month stands: **Not sent for approval**, **Waiting for approval**, **Approved** or **Sent back**.
2. When the month is ready, choose **Send for approval**. It says **Sent for approval.**
3. The approver (by default the person's manager) sees **Waiting for your approval**, and the month waits in **Approvals** as a **Journey plan**. On the plan page, choose **Approve plan** (it says **Plan approved.**), or **Send back**, write **Why are you sending it back?** (at least 3 characters) and choose **Send back** again (it says **Plan sent back.**).
4. A month sent back can be changed and sent again.

## What the system checks

- A visit's status moves by itself (BR-35, `nextPlanStatus()`): **Planned**; **Visited** once a visit starts from it; **Completed** when a form filled in that visit is approved; back to **Planned**, or **Missed** after its day, when it is rejected; **Missed** when its day ends still planned; **Cancelled** only from planned.
- A route's days in a month are worked out by `routeDates()`.
- A planned visit is refused for an account the person doesn't see.
- While a month waits for approval or is approved, it can't be changed: only visits the person adds by hand on the day still go in (decision D53).
- Nobody approves their own month.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This changed somewhere else. Refresh and try again. | The month is waiting for approval or approved, so it can't change; or someone changed it meanwhile. | Reload. To change an approved month, there is no way back to draft: plan the change as a visit the person adds on the day. |
| This is outside the people and places you look after. | The person, or the account, is outside the scope. | Choose an account the person sees, or ask their manager. |
| You don't have access to this. | Your role can't plan visits or keep routes. | Ask your admin. |
