# Set up expense policies

| | |
|---|---|
| **Who** | Admin or Business head (`expense_policy.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Expense policies** |
| **Module** | **Expenses** |
| **Related** | [Set the organisation's rules](rules.md) (the odometer at the start and end of the day), [Set up approval chains](approval-chains.md) |

Each policy says how a claim is paid, at what rate, within which caps, and what proof it needs. People claim under a policy on the phone; approvers see what the policy allows. A change applies to claims from the day you choose; earlier claims keep the terms they had.

## Before you start

- Designations are in place, if rates differ by designation.
- For per-km claims from odometer readings, decide whether people record the odometer at the start and end of their day. That is the **Odometer when the day starts and ends** setting on [Set the organisation's rules](rules.md).
- Decide each new policy's **Key** now. Policies stay once added, as claims name them; switch one off instead.

## Steps

1. Open **Settings** › **Field work** › **Expense policies**. Each policy shows as **Policy 1**, **Policy 2** and so on.
2. To add one, select **Add a policy**. A policy not yet saved can be taken out with **Remove**.
3. For each policy, fill in:
   - **Key**: lowercase letters, digits and underscores; it never changes. A saved policy's key is kept, as claims name it.
   - **Category**: **Travel**, **Daily allowance** or **Other**.
   - **Name in English** and **Name in Hindi**.
   - **Pays**: **Per km**, **Per day**, **Per completed visit**, or **The bill amount**.
   - For **Per km** only, **Kilometres from**: **Odometer readings** or **Tracked distance**. Tracked distance adds up the day's ended shifts. Either way, claims show both and flag a gap.
   - Unless it pays the bill amount, **Rate**: **The same for everyone**, with one **Rate**, or **By designation**, with a **Rate for** each designation. Leave a designation's rate empty if they can't claim under this policy.
   - **Cap per claim**, **Cap per day**, **Cap per month**. Leave any empty for no cap.
   - **Needs a receipt**: nobody can approve a claim until it has one.
   - For **Per km** only, **Needs odometer photos**: photos of the opening and closing readings.
   - **In use**: switched off, nobody can claim under it.
4. Choose **Changes apply from**. Claims for earlier days keep the terms they had.
5. Select **Save policies**. You see **Saved.**

## What the system checks

- What a claim comes to (BR-29, `claimBase()`): per km pays the distance at the rate (the odometer's closing less opening, or the day's tracked kilometres); per day pays the days; per visit pays the visits completed that day; the bill amount pays the bill. Amounts are exact to the paisa.
- Caps (BR-29, `capClaim()`): the per-claim cap first, then what is left of the per-day and per-month caps after the person's other waiting and approved claims under the policy. A capped claim is paid the cap, not refused.
- A claim is refused when the policy is switched off, gives no rate for the person's designation, the day is in the future, readings or photos the policy needs are missing, the closing reading is below the opening, a tracked claim's day has no ended shift, or nothing is left under the caps (`claimIssues()`).
- A claim under a policy that needs receipts passes no approval step without one (BR-30).
- Odometer and tracked kilometres more than 10% and at least 2 km apart are flagged for approvers (D115, `distanceGap()`). Duplicate receipt photos are flagged, never blocked (BR-40).
- Each change is kept as a version from its day (`on()` finds the version in force on a claim's day).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A policy broke a rule, such as a per-km policy without a rate. The reason shows under the field. | Fix it and save again. |
| A person can't claim under a policy | It is switched off, or gives no rate for their designation. | Tick **In use**, or fill in the **Rate for** their designation. |
| A claim waits and can't be approved | The policy needs a receipt and the claim has none. | Ask the person to add the receipt from the phone. |
| This feature is switched off for your organisation. | **Expenses** is off. | Switch it on in **Settings** › **Organisation** › **Modules**, if your plan includes it (see [Switch modules on and off](modules.md)). |

## Waiting on the owner

- Kunal is still to confirm the agri template's expense rates (D27), which start at a per-km fuel rate and daily allowances by designation.
