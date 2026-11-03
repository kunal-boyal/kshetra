# Set up metrics and the score

| | |
|---|---|
| **Who** | Admin or Business head (`metric.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Metrics** |
| **Module** | Core |
| **Related** | [Build and publish a form](forms.md), [Lay out each role's Home](dashboards.md), [Set the organisation's rules](rules.md), [Set targets and account plans](../manager/targets-and-account-plans.md) |

A metric is what is counted for each person every day, then rolled up to months, teams and territories: forms submitted, accounts visited, order value, money collected. Targets and the score are built on metrics. Change a metric when what it counts changes, and choose the day from which people's figures are worked out again.

## Before you start

- The forms a metric counts are published, and you know the keys of the fields it adds up.
- Decide each metric's **Key** and **Unit** now. A metric keeps both: targets refer to it by key, and its targets and daily values are kept in its unit.

## Steps

### Add or change a metric

1. Open **Settings** › **Field work** › **Metrics**. The table lists each metric with its key, **Unit**, **Source** and **Status** (**In use** or **Retired**). The score is below it.
2. Select **Add a metric**, or select a metric to change it.
3. Under **Names**, fill in:
   - **Key**: lowercase letters, digits and underscores.
   - **Unit**: **Count**, **Money**, **Quantity**, **Percent** or **Time**.
   - **Name for one, in English**, **Name for many, in English**, and the same in Hindi.
   - **Better when**: **Higher** or **Lower**.
   - **Can carry targets** (the tenant's word for targets): tick it for a metric that targets and the score may use.
   - **Who sees it**: tick roles, or choose none for every role.
4. Under **Where its values come from**, choose the **Source**. The line under it says what it counts. Then fill in what that source asks for:

   | Source | What it counts | Asks for |
   |---|---|---|
   | **Forms submitted** | Approved submissions of the chosen forms | **Forms** |
   | **Sum of a form field** | A number field added up across approved submissions | **Forms**, **Field key** |
   | **Sum of item lines** | The quantity or value of item lines | **Forms**, **Field key**, **Add up** (**Quantity** or **Value**) |
   | **Accounts visited** | Each account visited once a day | **Forms**, **Only these types**, **Only this segment** |
   | **Coverage** | The share of those a person looks after that were visited | **Forms**, **Only these types**, **Only this segment** |
   | **Visit frequency kept** | The share visited as often as their segment expects | **Forms**, **Only these types** |
   | **Plan kept** | The share of planned visits that were visited | nothing more |
   | **Time on visits** | Time between check-in and check-out | **Show** (**The total** or **The average**), **Only these types** |
   | **Order value** | The value of orders in the chosen statuses | **Statuses that count**, **Amount** (**Before tax** or **After tax**) |
   | **Order quantity** | The quantity of orders in the chosen statuses | **Statuses that count**, **Measure** (**Base units**, **Kilograms**, **Litres**) |
   | **Productive visits** | Visits where orders were taken | **Only these types** |
   | **Order lines** | Lines in orders in the chosen statuses | **Statuses that count** |
   | **Sell-through** (the tenant's word, Liquidation in the agri template) | What accounts sold through, from monthly stock statements | **Measure** (**Value** or **Quantity**), **Item codes** |
   | **Money collected** | Money people collected; rejected and bounced collections don't count | nothing more |
   | **Active days** | Days with at least one approved submission | **Forms** |
   | **New accounts** | New ones of the chosen type, once approved | **Type** |
   | **Loaded from outside** | Values that come in through an import or the API | nothing more |
   | **One metric divided by another** | Summed parts of two metrics, divided; times 100 for a percent | **Divide**, **By** |

   Source names follow your terminology, so "Accounts" and "Orders" show in your organisation's words. A metric from a template may count only submissions that match a rule; the editor keeps that rule as it is.
5. For a new metric, select **Add the metric**. It is worked out from the first of this month.
6. For an existing metric, under **In use and from when**:
   - Untick **In use** to retire it.
   - Choose **Work values out again from**: today, or a day within the last 92 days.
   - Select **Save and work out again**. People's daily figures are rebuilt from that day; scores read the new values at once.

### Set the score

7. Under **The score**, select metrics in **Add a metric to the score** and give each a **Weight of** it. The page shows what the weights add up to; they need not make 100, as each metric's share is its weight over the total. **Remove** takes a metric out.
8. Set **Most one metric can count, in percent**: from 100 to 200. At 100, going past the target counts no more than meeting it.
9. Choose **Count targets and scores by**: a month, or a quarter or the year of your financial year. If you change it, choose **Starting from**: a period still to come, so no day counts twice. A notice shows the change waiting; choose the current kind again to call it off.
10. Select **Save the score**. You see **Saved.**

## What the system checks

- A metric keeps its key and unit.
- Only metrics that can carry targets go in the score, each once (BR-06). Each weight is a whole number from 1 to 100; there are at most 20 metrics.
- The score is each metric's achievement against its target, capped, weighted and averaged (BR-06). People are ranked within their designation (BR-07).
- A retired metric must first come out of the score, and out of any ratio that divides by it.
- A day's values belong to the person who captured them, on the tenant's clock (BR-03).
- Working out again only reaches back 92 days; earlier days keep their figures.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A rule was broken; each problem is listed with where it is. | Fix each one and save again. |
| "The score uses this metric; take it out of the score first" | You tried to retire a metric the score uses. | Take it out of the score, save the score, then retire the metric. |
| "Choose a day within the last 92 days" | The recompute day is too far back. | Choose a later day. |
| This metric could not be found. | The link points to a metric that isn't there. | Go back to **Metrics**. |
| A metric shows nothing | Its forms aren't approved yet, or a key is wrong. | Check the form keys and **Field key**; check that submissions are approved. |

## Waiting on the owner

- The server's field-error texts, quoted above, are in English only.
