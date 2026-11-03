# Read the attendance register

| | |
|---|---|
| **Who** | Manager, Business head, Admin, Back office (`user.view`; `approval.act` to decide leave and fixes; `report.view` and `export.create` to export; `calendar.manage`, held by Business head and Admin, for holidays) |
| **Where** | Web portal › **Attendance** |
| **Module** | Leave and attendance |
| **Related** | [Decide approvals](approvals.md), [Follow the team on the live map](live-map-and-trails.md), [Payroll](../back-office/payroll.md), [Reports](../back-office/reports.md) |

The register shows each person's month a day at a time, worked out from their shifts, approved leave, approved fixes, holidays and weekly offs. Read it to see who worked, who was on leave and which days need fixing, and decide the leave and fixes waiting for you.

## Before you start

- The register is worked out, not typed in: a day changes only when a shift, an approved leave or an approved fix changes it.
- Holidays and weekly offs come from each person's calendar, which an admin keeps in Settings › **Holiday calendars** (**Holidays** on this page opens it).

## Steps

### Read the month

1. Open **Attendance** in the left rail. The heading names the month: **Attendance · …**.
2. Change the month with **Previous month** and **Next month**.
3. Under **Show**, **Register** is chosen. To see one territory, choose it under **Territory**; **Any** shows everyone you see.
4. Each row is a person and each column a day. **What the letters mean** explains them: **P** **Present**, **H** **Half day**, **L** **Leave**, **A** **Absent, to fix**, **W** **Off or holiday**. The last column, **P**, totals the present days.
5. Choose **Leave** under **Show** to list the leave taken in the month: **Person**, **Type**, **Dates**, **Days** and **Status**.

### Export the register

1. Choose **Export register**. The month and territory you chose go into an Excel file.
2. The portal opens **Reports**, where the file appears under **Your downloads** when it is ready ([Reports](../back-office/reports.md)).

### Decide leave and fixes

1. **Waiting for a decision · …** lists the leave (**Leave**) and fixes (**Fix**) waiting for you, each with the person, what they asked and who it waits for.
2. Choose one to open **Approvals** at that kind of request, and decide it there ([Decide approvals](approvals.md)).

### Fix a day

You can't fix a day for someone from the portal. The person asks on their phone: on their attendance month they choose the day, **Fix this day**, **Count it as** present or half day, and a **Reason** of 3 to 600 characters. The request reaches the approvers of the **Attendance correction** chain, by default their manager. Once approved, the day changes in the register.

## What the system checks

- A day's status, in this order (BR-23, `dayStatus()`): a day still to come; before joining or after leaving; a shift that day, or an approved present fix, is present; an approved half-day fix or half-day hours is a half day; approved paid leave; approved unpaid leave; a holiday; a weekly off; otherwise absent. Presence wins over leave on the same day.
- A fix is for a past day, not before the person joined, one open request per person per day, present or half day (BR-28, `regularisationIssue()`).
- Leave counts working days on the person's own calendar; approved leave never marks a weekly off or a holiday (BR-27).
- Optional holidays never take a day off.
- You see only the people in your scope.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Nobody to show | Nobody you see worked that month, or in that territory. | Choose another month or **Any** territory. |
| **A** on a day the person worked | No shift reached the server for that day. | Check the person's upload queue on their phone; if the day was worked without a shift, they ask for a fix. |
| This feature is switched off for your organisation. | Leave and attendance is switched off. | Ask your admin. |

## Waiting on the owner

- Phase 2's exit check: about 30 minutes for Kunal to compare one month of the demo's register with his own count.
