# Follow the team's performance

| | |
|---|---|
| **Who** | Manager, Business head, Admin, Viewer (`performance.view_team`, `leaderboard.view`; `report.view` to export) |
| **Where** | Web portal › **Home** and **Performance**; phone › **Home** › My month and the leaderboard |
| **Module** | Core; Home layouts by role need Advanced analytics |
| **Related** | [Set targets and account plans](targets-and-account-plans.md), [Review submissions](review-submissions.md), [Reports](../back-office/reports.md), [Dashboards](../admin/dashboards.md) |

Home gives the day at a glance: the team's figures for the period, what waits for you and who is on duty. **Performance** shows each person's month against their targets, with score and rank, and the leaderboard. Only approved work counts toward targets, so review first and read the figures after.

## Before you start

- Figures need metrics your admin has set up; a score needs locked targets ([Set targets and account plans](targets-and-account-plans.md)).
- Ranks are within a group: people of a designation your admin marked as ranked.

## Steps

### Read Home

1. Open **Home**. The greeting carries the date, whether the figures are your team's or your own, and when they were read.
2. Change the period with the stepper beside the heading. **Reports** opens the reports.
3. The tiles show the team's figures for the period: **On duty now** with **… on leave**, then a tile per metric, approved beside waiting for review.
4. Below come **Day by day** (choose the **Metric**; **Show the numbers** gives the table), **Forms this period** by form and review status, the leaderboard (**Leaderboard · …**), **On duty now · … of …** (**Live map** opens the map) and **Waiting for you**: **Forms to review**, **Plans to approve**, **Leave and attendance**, **Expense claims** and **Other requests**, each opening where you decide them.
5. Where your admin laid out Home for your role (Advanced analytics), the cards follow that layout instead, and may break a metric down **… by person** or **… by territory**.

### Read the team's month

1. Open **Performance** in the left rail. The heading is **Performance · …**; change the month beside it.
2. Choose **My team**. A row for each person: **Rank**, **Person**, **Territory**, a column per metric with **of …** (their target), **Score**, and **Since last week** (**Up …**, **Down …**, **Same** or **Nothing to compare yet**). **Team total** sums the team. Narrow by **Designation**.
3. Choose a name to open their month: **…’s month**, their **Ranked among** group and **… of …**, a tile per metric with **of …**, **+… pending** for work still waiting for review, **Draft target** or **No target set**, and **Day by day** for each day's approved values.

### Read the leaderboard

1. On **Performance**, choose **Leaderboard**. Choose the **Group**.
2. Each row has its rank, the person and **Score**; **(you)** marks you. **How the score is made** shows the metrics' weights; with `metric.manage`, **Change in settings** opens them.
3. **Export** opens **Reports**, for the **Targets against achievement** report.

### On the phone

1. Your own month is My month on **Home**; your group's leaderboard sits beneath it.
2. Open the leaderboard to see the whole group: choose the **Group**; the page reads **Indicative ranking. People without locked targets are not ranked.** It is read online.

## What the system checks

- Values belong to the person who captured the work and the day it was captured, on the organisation's clock (BR-03). Only approved submissions count toward targets.
- The score is the weighted share of each scored metric's target met, capped, out of 100; it exists only with locked targets and every scored metric above zero, so a person without one is **Not ranked**, never ranked at zero (BR-06, `scoreOf()`).
- Equal scores share a rank and the next rank is skipped (1, 1, 3); people without a score come last, unranked (BR-07, `rankByScore()`).
- Ratios are worked from summed parts, never an average of ratios (BR-04).
- Ranks are indicative until the period is reviewed and closed; Home says so.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No figures yet | No metrics are set up for your organisation. | Ask your admin. |
| No score yet: scores need locked targets with every scored metric above zero. | The person's targets aren't locked, or a scored metric has no target. | Set and lock their targets. |
| Not yet counted | The metric's records haven't arrived in the product yet. | Wait; external values arrive through the API. |
| Nothing approved this period yet. | Nothing is approved yet. | Review the waiting submissions. |
| This took too long to read. Narrow it down, or export it instead. | The page took too long to read. | Narrow it, or export the report. |
