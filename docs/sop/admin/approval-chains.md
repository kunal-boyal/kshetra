# Set up approval chains

| | |
|---|---|
| **Who** | Admin or Business head (`workflow.manage`) |
| **Where** | Web portal › **Settings** › **People and access** › **Approval chains** |
| **Module** | Core (a request type of a module that is off leaves the inbox) |
| **Related** | [Set up leave types](leave-types.md), [Set up expense policies](expense-policies.md), [Set the organisation's rules](rules.md), [Decide approvals](../manager/approvals.md) |

An approval chain says who decides each kind of request, step by step: leave, attendance fixes, expense claims, orders, new accounts, account locations and journey plans. A type without a chain goes to the requester's manager. Each save is a new version; requests already waiting keep the version that routed them.

## Before you start

- Roles, designations and the reporting lines (each person's manager) are in place. Most steps find their approver through them.
- For a step that goes to whoever fills an account's slot, the account types have their slots set.

## Steps

### Set who decides when no step remains

1. Open **Settings** › **People and access** › **Approval chains**.
2. Under **When no step remains**, choose the **Role**. People with this role decide requests that have no one else to go to. The choice saves at once.

### Change a chain

3. In **Request types**, select a type. Each shows its chain in a line, such as "Their manager, then Head", or **The requester’s manager** when it has none. The chain's page shows **No chain** or its version, such as **Version 3**, with when and by whom it was saved.
4. Select **Edit**.
5. For each step, choose **Who decides**:
   - **A manager above them**: set **How far up** (1 is their own manager, 2 is that manager's manager).
   - **The nearest above with a designation**: choose the **Designation**.
   - **Anyone with a role who reaches them**: choose the **Role**. Anyone with that role whose data scope reaches the requester may decide.
   - **Whoever fills a slot of the account** (the tenant's word for account): choose the **Slot**. Only for requests about an account.
   - **One named person**: under **Person**, type part of their name, code or mobile number (**A name, code or mobile number**) and select them from the matches. Everyone active you reach can be found, however many people the organisation has. To name someone else later, select **Change** beside the person.
6. To use a step only sometimes, select **Add a condition** under **Use this step only when**, and build it as in the form builder: **Match** all or any, then each condition's **Field**, **Is** and **Value**. The fields depend on the request type:
   - Leave: "Leave days", "Paid leave".
   - Attendance fixes: "Days ago".
   - Expense claims: "Amount", "Over the policy".
   - Orders: "Order total", "Over the credit limit", "More than the supplier holds".
7. Under **When nobody is found**, choose **Skip the step** or **Send it to a role**, and then the **Role to send it to**.
8. Set **Remind after (hours)** and **Escalate after (hours)**, and for an escalation, **Escalate to** a role. Leave either empty for never.
9. For orders only, tick **Decide line by line** to let this step accept or reject each line.
10. Use **Move up**, **Move down** and **Remove step 2** (and so on) to arrange steps, and **Add a step** to add one.
11. Select **Save chain**. You see "Saved as version 4." **Cancel** leaves the chain as it was.

The chain's page then reads each step in words, for example "When Leave days more than 3", "A reminder after 24 hours", "After 48 hours, it goes to Head", "If nobody is found, it goes to Admin".

### Stand-ins while an approver is away

Delegation is not set here. Each approver hands over their own approvals on their **Approvals** page, under **Waiting for me** › **While you’re away**:

1. Choose **Who decides for you**, then **From** and **Until**, and select **Hand over**. You see **Handed over.**
2. The card lists each handover as **Now** or **Coming**, for example "Asha Rao decides for you, 3 Nov 2026 to 7 Nov 2026". **End now**, then confirming, ends one early.

The approver can still decide too. An admin can't hand over for someone else.

## What the system checks

- Routing (BR-31, `routeRequest()`): a request skips a step nobody can take, never goes to the person who asked it, and never asks the same person twice in a row. With no step left, it goes to the fallback role.
- A step's condition is judged on the request's facts when it starts.
- Reminders and escalations are checked every 15 minutes, so one may arrive up to 15 minutes after its hour.
- Delegation (decision D113): the stand-in must be someone else, active, and able to approve requests. The days start today or later, end on or after the first, last at most 90 days, and may not overlap another handover by the same approver. A decision taken by a stand-in records whom it was for.
- Every role, designation, slot and person a step names must exist.
- Every save is made at the version you opened.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A step broke a rule; the reason shows beside the field. | Fix it and save again. |
| This changed somewhere else. Refresh and try again. | Someone saved this chain after you opened it. | Reload and make your change again. |
| Requests go to the wrong person | The reporting line, the role's data scope or the slot holder isn't what the chain expects. | Check the requester's manager and the approver's role and scope; check the chain's version the request names. |
| A request keeps going to the fallback role | No step found anyone. | Add a step that reaches someone, or set **When nobody is found** to **Send it to a role**. |
