# Set up leave types

| | |
|---|---|
| **Who** | Admin or Business head (`leave_type.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Leave types** |
| **Module** | **Leave and attendance** |
| **Related** | [Keep holiday calendars](calendars-and-holidays.md), [Set up approval chains](approval-chains.md) |

Each leave type says whether it is paid, how many days a year it allows and when that year starts, how the days are credited, how many carry into the next year, and whether half days are allowed. People ask for leave by type on the phone; approvals follow the leave chain. Set types up before people start asking, and review them before each leave year.

## Before you start

- Holiday calendars hold the year's holidays, since leave counts only working days.
- The templates start with Casual leave (12 days, paid), Sick leave (12 days, paid) and Unpaid leave (no limit), all on the calendar year with half days. Change them to your policy.
- Decide each new type's **Key** now. Types stay once added, as requests name them; switch one off instead.

## Steps

1. Open **Settings** › **Field work** › **Leave types**. Each type shows as **Leave type 1**, **Leave type 2** and so on.
2. To add one, select **Add a leave type** (at most 30). A type not yet saved can be taken out with **Remove**.
3. For each type, fill in:
   - **Key**: lowercase letters, digits and underscores; it never changes. A saved type's key is kept, as requests name it.
   - **Name in English** and **Name in Hindi**.
   - **Days a year**: whole or half days; 0 means no limit.
   - **The year runs**: **January to December**, or **With the financial year** (as set on [Set the organisation's rules](rules.md)).
   - **How days are credited**: **All on the year’s first day**, or **A share each month**. Monthly credits a share of the days each month, so people can take only what has built up.
   - **Carry into next year, at most**: unused days up to this many move into the next year when it starts; the rest lapse. 0 carries none.
   - **A document is needed after (days)**: leave longer than this needs a document, such as a doctor's note. Leave it empty for never.
   - **Paid**: a day of it counts as a paid day.
   - **Half days allowed**.
   - **In use**: switched off, nobody can ask for it.
4. Select **Save leave types**. You see **Saved.**

## What the system checks

- A request counts the working days between its dates on the person's own calendar, halved for a half day (BR-27, `leaveDays()`).
- A request is refused when the type is switched off, the dates run backwards or over a year, a half day is asked for on a type without them or over more than one day, the days are all off days, a document is missing past the type's limit, it overlaps other leave, or it is more than the days left (BR-27, `leaveIssues()`).
- What is left is judged against what has been credited by the request's start date and carried in, not the whole year's days (D114).
- Monthly credit (`leaveCredited()`): a share for each month from the year's first month, or the person's joining month if later, in whole half days rounded down; the year's last month brings the total to the full **Days a year**. Someone who joins mid-year gets only the months from their joining.
- Year end (`closeLeaveYear()`): credited plus carried in, less taken, carries over up to the cap; the rest lapses. Each year's closing is kept, and worked out again if a request in a closed year is decided later.
- Approved leave never marks a weekly off or holiday.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A type broke a rule, such as a key another type has. The reason shows under the field. | Fix it and save again. |
| This is over your limit. / This is more than the days left this year | A person asked for more than has been credited and carried in. | Check their balance; with monthly credit, fewer days have built up early in the year. |
| A type is missing on the phone | It is switched off, or the phone hasn't synced since. | Tick **In use**, save, and ask them to open the app online. |
| This feature is switched off for your organisation. | **Leave and attendance** is off. | Switch it on in **Settings** › **Organisation** › **Modules**, if your plan includes it (see [Switch modules on and off](modules.md)). |

## Waiting on the owner

- Kunal is still to confirm the templates' starting leave types.
