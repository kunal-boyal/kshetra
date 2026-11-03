# Claim an expense

| | |
|---|---|
| **Who** | Field user, Manager (`expense.claim`) |
| **Where** | Field app › **Home** › **Claim an expense**; Field app › **More** › **Expenses** |
| **Module** | Expenses |
| **Related** | [Start your day](start-your-day.md), [End your day](end-your-day.md), [Use the upload queue](upload-queue.md) |

You claim travel and other costs against your organisation's expense policies: per km, per day, per completed visit, or the bill amount. The phone works out the amount as you fill it in, says what would be refused, and sends the claim for approval.

## Before you start

- The Expenses module is on, and your admin has set policies with a rate for your designation.
- Claims work offline: the policies and your claims for the month are kept on the phone, and a claim waits to upload. A per-km claim from tracked distance reads your shifts online.
- For a per-km claim, have the day's odometer readings and photos ready, or, where your organisation asks for them at the start and end of the day, they come from your shift ([Start your day](start-your-day.md)).

## Steps

### Make a claim

1. On **Home**, tap **Claim an expense**, or open **More** › **Expenses** and tap **Claim an expense**.
2. Under **What for**, choose the policy. Each says how it pays: **Per km**, **Per day**, **Per completed visit** or **The bill amount**; a per-km policy that pays tracked distance adds **from tracked distance**.
3. **Tap the day of the expense** on the month (**Previous month**, **Next month** to move).
4. Write a **Description**, 3 to 300 characters.
5. Fill what the policy pays by:
   - A per-km policy paid from odometer readings: type the **Opening reading** and **Closing reading**, and tap **Photograph a reading** for each. If your shift that day recorded readings, the claim starts from them: **From your shift: … to … km. Its photos go with the claim; change a reading only if it was wrong, and your approver will see it.**
   - A per-km policy paid from tracked distance: the screen says **Tracked on your shifts that day: … km**. **Readings are optional; they show beside the tracked distance.** If a shift that day is still open, it says **End the day's shift first; its distance is known once it ends.**
   - **Per day**: type the **Days**, whole or half, such as 2 or 1.5.
   - **Per completed visit**: **Worked out from the visits you completed that day.**
   - **The bill amount**: type the **Bill amount**.
6. Take receipts with **Photograph a receipt**. If the policy needs one, it says **This policy needs a receipt before anyone can approve the claim.**
7. The screen shows **Comes to …**, and **Capped from …** when a cap brought it down, and any problem the server would refuse.
8. **After you send it** shows who decides, step by step.
9. Tap **Send the claim ·** the amount.

### Follow your claims and add a receipt

1. Open **More** › **Expenses**. The row there shows what is still waiting for a decision this month (**… open**).
2. Move between months with **Previous month** and **Next month**. The top shows **Claimed this month**.
3. Each claim shows its policy, day, amount, **Capped from …**, tracked kilometres (**… km tracked**), any flag, and its state: **Waiting**, **Approved**, **Rejected**, **Cancelled** or **Paid**. A claim still on the phone says **Sends when there is signal**.
4. To add a receipt to a waiting claim, tap **Add a receipt** on it and take the photo. It says **Receipt sends when there is signal** until it uploads.

## What the system checks

- The policy is on and has a rate for your designation; the day has passed or is today; the readings, days or bill the policy pays by are filled; the closing reading isn't below the opening one; per-km claims from readings carry photos of both readings (BR-29, `claimIssues()`).
- Daily and monthly caps bring the amount down; once they are used up, the claim is refused (BR-29, `capClaim()`).
- A claim whose policy needs a receipt can be sent without one, but nobody can approve it until it has one (BR-30).
- A receipt photographed before is flagged **Receipt seen before**, never blocked (BR-40).
- Readings changed from your shift's are flagged **Readings changed from your shift**; tracked and odometer kilometres that differ are flagged **Tracked and odometer kilometres differ** (decision D115).
- A tracked claim uploads after every punch-out of its day; a claim from a shift's readings after that shift's end.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **This policy has no rate for your designation** | Your designation isn't covered | Ask your admin |
| **The day can’t be in the future** | The day picked is in the future | Pick the day of the expense |
| **Enter the opening and closing readings** / **The closing reading is below the opening one** | The readings are missing or wrong | Correct the readings |
| **Add photos of the opening and closing readings** | Odometer photos are missing | Tap **Photograph a reading** |
| **Enter the days** / **Enter the bill amount** | The figure the policy pays by is missing | Fill it in |
| **You completed no visits on this day** | A per-visit policy, no completed visits | Pick another day or policy |
| **The caps for this day or month are used up** | Nothing left under the caps | Nothing to claim |
| **You have no ended shift on this day to take the distance from** | A tracked policy, no ended shift | End the shift first, or pick another day |
| **No distance was tracked on this day** | The shifts recorded no distance | Ask your manager; use a readings policy if there is one |
| **Write at least 3 characters** | The description is too short | Write more |
