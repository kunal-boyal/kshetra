# Set targets and account plans

| | |
|---|---|
| **Who** | Manager, Business head, Admin (`target.view`; `target.edit` to set and copy; `target.lock` to lock; `target.unlock`, held by Business head and Admin, to unlock; `account_plan.manage` for account plans; `forecast.record` and `forecast.adjust` for forecasts) |
| **Where** | Web portal › **Targets**; **Accounts** › an account › **Monthly plan** and **Forecast** |
| **Module** | Core |
| **Related** | [Follow the team's performance](team-performance.md), [Plan a person's month](journey-plans.md), [Imports and exports](../back-office/imports-and-exports.md), [Metrics and the score](../admin/metrics-and-score.md) |

Targets (the tenant's word for them) say what each person should reach in a month, metric by metric. You set them in draft, then lock them: only locked targets give a score and a rank. An account's monthly plan and its forecast are references for the team kept on the account's page; they never change anyone's targets.

## Before you start

- Only metrics your admin made targetable appear. If none is, **Targets** says **Nothing to set yet**.
- You set targets for the people in your scope, never your own: **Your own** shows yours, read only.
- Unlocking needs the organisation's setting **Admins may unlock locked targets** (Settings › **Rules** › **Approvals**) and `target.unlock`.

## Steps

### Set and save targets

1. Open **Targets** in the left rail. Choose the month with **Previous month** and **Next month**.
2. The heading counts the people, with **… locked**, **… in draft** and **… not set**.
3. The grid has a row for each person and a column for each metric, with each row's **Status**: **Not set**, **Draft** or **Locked**. **Team total** sums the team; **Your own** shows yours.
4. Type a value into a person's cell. The page counts **… changes not saved**.
5. Choose **Save changes**, or **Discard changes**. It says **Changes saved.**

### Copy last month's targets

1. Tick **Select …** beside each person, or **Select everyone**.
2. Choose **Copy for … people**. It asks **Copy …’s targets for … people?**, naming last month.
3. Confirm with **Copy for … people**, or **Cancel**. Copied targets are drafts: change any value, then save.

### Lock targets

1. Select the people whose targets are right.
2. Choose **Lock … people**. It asks **Lock the targets of … people?** and says: **Once locked, only an administrator can unlock them, with a reason.**
3. Confirm with **Lock … people**. It says **Targets locked for … people.** Each row then shows **Locked by …**.

### Unlock a person's targets

Business head or Admin (`target.unlock`), where the organisation allows it.

1. On the person's locked row, choose **Unlock**.
2. Under **Unlock the targets of …**, write the **Reason** (at least 10 characters; it goes into the audit log).
3. Choose **Unlock**. It says **Targets of … unlocked.** Change the values, save and lock again.

A person's targets for the month also show on their **Plan** page, with how far they have come (**So far**) and an **Unlock** for those who may.

### Keep an account's monthly plan

1. Open **Accounts** (the tenant's word), choose the account, and go to **Monthly plan**.
2. Choose the **Month**. Type a planned value for each metric; leave one empty to clear it.
3. Choose **Save plan**. It says **Plan saved.**, and the section shows **Last changed by …, …**.

### Keep an account's forecast

1. On the account's page, go to **Forecast**. It opens on next month; change it with **Previous month** and **Next month**. Each month says **Open until the month begins** or **Locked**.
2. Choose **Change**. Each item has a **Quantity**, in its base unit. Use **Add an item** and **Choose an item** to add one; write 0 to take an item out.
3. For a locked month (`forecast.adjust`, Manager and above), write **Why the locked month changes**.
4. Choose **Save the forecast**. It says **Saved as version ….** **Versions** lists who saved each version and when, and any reason given after the lock.

## What the system checks

- A target or plan value is zero or more: whole for counts, at most 2 decimals for money, percentages and durations, 3 for quantities (`targetValueIssue()`).
- Nobody sets their own targets. A locked target set changes only after an unlock, which needs the organisation's setting, `target.unlock` and a reason of at least 10 characters (BR-08, `unlockRefusal()`). Locks and unlocks are recorded.
- A score exists only for locked targets with every scored metric above zero (BR-06).
- A forecast is kept for the three months after this one. Each save is a new version, merged over the last; the latest counts. From a month's 1st it is locked: only `forecast.adjust` changes it, with a reason (BR-54, `forecastOpen()`, `forecastAfterLock()`).
- How close forecasts came is the **Forecast accuracy** report (BR-54, `forecastAccuracy()`).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This target is locked and can no longer be changed. | The targets are locked, or the organisation doesn't allow unlocking. | Ask a Business head or Admin to unlock them, or your admin to allow unlocks. |
| Some details need fixing. Check the highlighted fields. | A value breaks the rules above, or the unlock reason or forecast reason is missing or short. | Fix the field, then save again. |
| Write a quantity such as 12 or 0.5, 0 to take the item out. | A forecast quantity isn't a number. | Correct it. |
| This changed somewhere else. Refresh and try again. | Someone else saved these targets or this plan meanwhile. | Reload, then make your change again. |
| You don't have access to this. | Your role can't do this, or you tried your own targets. | Ask your manager or admin. |

## Waiting on the owner

- One real example of how product forecasts per account are made today, to check the forecast design against (D109).
