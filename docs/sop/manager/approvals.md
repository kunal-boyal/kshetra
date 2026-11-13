# Decide approvals

| | |
|---|---|
| **Who** | Manager, Business head, Admin (`approval.act`; `account.approve` for new accounts and location changes; `order.decide` and `order.line_decide` for orders, see below) |
| **Where** | Web portal › **Approvals**; phone › **Team** › **Approvals** |
| **Module** | Core; leave and attendance corrections need Leave and attendance, expense claims Expenses, orders the Orders module |
| **Related** | [Approval chains](../admin/approval-chains.md), [Read the attendance register](attendance.md), [Plan a person's month](journey-plans.md), [Process orders](../back-office/process-orders.md), [Pay expense claims](../back-office/expense-payouts.md) |

Requests your team makes wait in your inbox until you decide them. Each kind of request follows its chain of steps; when you approve, it moves to the next step or, at the last one, takes effect. When you reject, it ends there.

The kinds of request are **Leave**, **Attendance correction**, **Expense claim**, **Order** (the tenant's word for orders), **New accounts**, **Account location** and **Journey plan** (Beat plan in the agri template, Tour plan in pharma, PJP in FMCG).

## Before you start

- Your admin sets each kind's chain in Settings › **Approval chains**. A kind without a chain goes to the requester's manager (BR-31).
- A request reaches you only when it is your step: as the requester's manager, as the holder of a role or slot the step names, or because you stand in for someone (below).

## Steps

### Decide one request on the web

1. Open **Approvals** in the left rail. Its count is what waits for you. **Waiting for me** is chosen.
2. To see one kind only, choose its button, which carries the kind and how many wait, such as **Leave (…)**; **All (…)** shows every kind.
3. Each request shows its title, **Asked by …, …**, and **Approval steps**: each step with who approved or rejected it, who it waits for, and steps **Skipped**, **Escalated** or **Not reached**. A request you see because you stand in for someone says **On behalf of …**.
4. Choose **Approve**, or choose **Reject**, write **Why are you rejecting it?** (at least 3 characters; the person who asked sees it), then **Reject** again. **Cancel** steps back.
5. An **Expense claim** shows **Show the claim**: the claim opens in the card with its amount, what the policy made of it, its flags and its **Receipts** and **Odometer photos**, each opening full size. **Hide the claim** closes it. You see it, and its photos, as long as you take part in its approval, standing in for someone included, even when the person is outside your team (decision D142).
6. An **Order** shows **Open to decide** instead. It opens the order's own page, where you accept or reject it whole or line by line ([Process orders](../back-office/process-orders.md)).

### Approve several together

Leave, attendance corrections, expense claims, new accounts and journey plans can be approved together; orders and location changes can't.

1. Under **Approve together**, choose **Select all … that can be approved together**, or tick **Select** on the requests you want.
2. Choose **Approve … selected**.
3. The page says **Approved … requests.** and lists any that weren’t approved under **… requests weren't approved:**, each with its reason. The rest stay approved: one refusal doesn't undo the others.

### Withdraw your own request

1. Choose **My requests**. Each request you sent shows where it stands.
2. On one nobody has decided yet, choose **Withdraw**. It asks **Withdraw this request?**; choose **Withdraw** again, or **Keep it**.

### Hand over while you're away

`approval.act` holders.

1. On **Approvals**, under **Waiting for me**, go to **While you’re away**.
2. In **Who decides for you**, choose a person. In **From** and **Until**, give the days.
3. Choose **Hand over**. It says **Handed over.**, and shows **… decides for you, … to …** with **Now** or **Coming**.
4. To stop early, choose **End now**, then **End now** again. Requests go back to waiting for you alone.

While a handover stands, what waits for you waits for your stand-in too; you can still decide. Their decision is recorded as theirs, for you, and the chain shows **Approved by … for …**. A handover you receive shows as **You decide for …, … to …**.

### On the phone

1. Open the **Team** tab, then **Approvals**. The count beside it is what waits.
2. Choose a kind under **Type of request**, or **All**.
3. Each card says **You decide.** or which step it is at. Choose **Approve** to approve it there.
4. To reject, choose **Reject**: the request opens. Write **Why are you rejecting it?** (at least 3 characters), then choose **Reject**.
5. An expense claim, opened, shows its amount, description, flags, **Receipts** and **Odometer photos**; tap a photo to open it full size (decision D142).
6. An order says **Decide this on the web portal, which asks for the reason and each line.**
7. **Back to Team** returns to the tab.

The phone decides one request at a time and needs a signal: nothing is kept on the phone.

## What the system checks

- Routing follows the chain's steps and their conditions; a step nobody can take goes to the chain's fallback approvers (BR-31, `routeRequest()`).
- Nobody decides their own request. Only the step's current approvers, or their stand-ins, decide.
- A rejection needs a reason of at least 3 characters.
- An expense claim under a policy that needs receipts can't be approved until it has one (BR-30, `receiptHoldsApproval()`).
- An order is decided on its own page, never from the inbox.
- Waiting steps send reminders and escalate on their time limits; the check runs every 15 minutes.
- A handover: someone else, who works here now and may approve requests; from today or later; until on or after the first day; at most 90 days; not over days another handover of yours already covers (`delegationIssues()`, decision D113).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| It isn't your turn to act on this, or someone else already has. Refresh your inbox. | The request moved on, or another approver decided it. | Reload **Approvals**. |
| Add a photo to continue. | The expense claim needs a receipt before approval (BR-30). | Ask the person to add the receipt on their phone, then decide. |
| You don't have access to this. | It is your own request, or an order you tried to decide outside its page. | Leave your own to the next approver; open the order's page. |
| This feature is switched off for your organisation. | The request's module is switched off; its requests leave the inbox. | Ask your admin. |
| This changed somewhere else. Refresh and try again. | The request was decided or withdrawn meanwhile. | Reload the page. |
| Some details need fixing. Check the highlighted fields. | A rejection without a reason, or a handover that breaks a rule above; the field says which. | Fix the field, then try again. |
| The server could not be reached. Check your connection, then try again. (phone) | No signal. | Try again with a signal. |

## Waiting on the owner

- WhatsApp notices of waiting requests stay off until a provider account exists; push needs the development build and Firebase.
