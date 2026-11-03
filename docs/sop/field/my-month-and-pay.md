# See your month and pay

| | |
|---|---|
| **Who** | Field user, Manager (the leaderboard: `leaderboard.view`; pay: `payslip.view`) |
| **Where** | Field app › **Home** › **My month**; **More** › **Leaderboard**; **More** › **My pay estimate** or **My payslips** |
| **Module** | Core for the month and leaderboard; Payroll inputs for the pay estimate; Statutory payroll for payslips |
| **Related** | [Attendance and leave](leave-and-attendance.md) |

My month shows how you stand against your targets this month, your score and your rank. Pay shows either an estimate from your attendance or, where your organisation runs statutory payroll in the app, your approved payslips.

## Before you start

- Your targets are set and locked by your manager. Without locked targets there is no score and no rank.
- My month is kept on the phone with when it was read, so it shows offline. The leaderboard, the pay estimate and payslips need signal.

## Steps

### My month

1. On **Home**, **My month** (or **My quarter** or **My year**, as your targets run) shows the first two figures and your rank (**Rank #… of …**), once the phone has read the month. Tap it, or **See my month**.
2. The month screen shows **My score** as a ring (**Score … out of 100**), your rank and how it moved (**Up … places since last week**, **Down …**, or **Same place as last week**), and **Updated …**.
3. Each metric shows the approved figure against its target (**… of …**), with **+… pending** for work not yet approved. **Only approved activities count toward your targets.** A metric with no target says **No target set**; one whose records haven't arrived says **Not yet counted**.
4. Below, **Leaderboard · …** shows the first rows of your group, your own row marked.

If your targets aren't locked, the screen says **No score yet: scores need locked targets with every scored metric above zero.**

### The leaderboard

1. Open **More** › **Leaderboard** (it shows your rank, such as #3).
2. Choose the **Group** if you can see more than one.
3. Each row shows the rank, the name and the score; yours says **(you)**. **Indicative ranking. People without locked targets are not ranked.**

### Your pay estimate

Where the Payroll inputs module is on and Statutory payroll is off:

1. Open **More** › **My pay estimate**.
2. It shows this month so far and last month: **Monthly gross**, **Paid days** (**… of …**), the present, half, paid leave, unpaid leave and absent days, and **Provisional pay so far: …** or **Provisional pay: …**.
3. **Attendance-based estimate. This is not a statutory payroll document.** Your organisation's payroll decides what you are paid.

### Your payslips

Where an admin has switched Statutory payroll on:

1. Open **More** › **My payslips**.
2. It opens on last month. Move with **Previous month** and **Next month**.
3. **Payslip · …** shows **Earnings**, **Deductions**, each with its **Total**, **Net pay: …** and the amount in words (**In words: … only**), with your UAN and ESI number where you have them.
4. A month not yet approved says **No approved payslip for … yet**.

## What the system checks

- Only approved activities count toward a target; what waits for review shows as pending (BR-02).
- Your score is worked out from locked targets with every scored metric above zero (BR-06); ranks are within your ranked group, and people without a score are not ranked (BR-07).
- The pay estimate is your monthly gross for the month, times paid days over the month's working days (BR-26, `provisionalPay()`).
- A payslip shows only once your organisation approves the month's pay run; an approved payslip never changes, and a correction comes in a later month.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **My month** doesn't show on Home | The phone hasn't read the month yet | Wait for signal |
| **No monthly gross for this month** | Your gross isn't recorded | Ask your HR or back office |
| **No approved payslip for … yet** | The month's pay run isn't approved | Wait, or ask HR |
| **Awaiting review by a chartered accountant. Check these figures with your accountant before paying.** | The statutory rules haven't been reviewed yet | Treat the figures with care |
| **The server could not be reached. Check your connection, then try again.** | The screen needs signal | Move to signal and **Try again** |

## Waiting on the owner

- Statutory payroll awaits a chartered accountant's review of its rules and rate sets; every payslip carries the review label until then.
