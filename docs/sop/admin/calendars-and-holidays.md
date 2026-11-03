# Keep holiday calendars

| | |
|---|---|
| **Who** | Admin or Business head (`calendar.manage`, which also gives a person a calendar) |
| **Where** | Web portal › **Settings** › **Field work** › **Holiday calendars** |
| **Module** | **Leave and attendance** |
| **Related** | [Set up leave types](leave-types.md), [Set up expense policies](expense-policies.md) |

Each person keeps a calendar of weekly offs and holidays; anyone not given one keeps the default. Attendance uses it to tell working days from days off, and leave counts only the working days on it. Add the coming year's holidays before it starts, and give people in other states or offices their own calendar.

## Before you start

- The calendars themselves, their names and weekly offs, and which one is the default, come from your template (the generic template has one, "Standard", with Sunday off). They are not edited on this page. To add a calendar or change its weekly offs, export the configuration from **Settings** › **Data** › **Export and import**, change its `people.calendars` and `people.defaultCalendar`, and import it again.

## Steps

### Add or take off holidays

1. Open **Settings** › **Field work** › **Holiday calendars**.
2. Choose the **Year**: last year, this year or next.
3. Each calendar shows as a card with its weekly offs ("Weekly offs: Sunday", or **No weekly offs**), **Default** on the default one, and its **Holidays in** that year with each **Date** and **Holiday** name.
4. To add a holiday, fill in **Date** and **Holiday** on that calendar's card. Tick **Optional** for a holiday that is listed but a working day unless the person takes leave. Select **Add the holiday**. You see **Saved.**
5. To take one off, select **Take off** beside it, then **Take off** again to confirm, or **Keep it**.

To add a year of holidays at once, import them: on **Imports**, choose **Holidays** under **People and places** in **What to import**; each row names the calendar, the date, the holiday and whether it is optional ([Import records from a spreadsheet](imports.md)). **Open holiday calendars** then leads back here.

### Give a person a calendar

6. Open the person's page under **People**. In its **Work** section, choose the **Holiday calendar**, or **The default (Standard)**. The change saves; days already gone follow it the next time they are worked out.

## What the system checks

- A day's status follows BR-23 in order (`dayStatus()`): a holiday or weekly off on the person's calendar is a day off unless they worked it.
- Optional holidays never take a day off; they are listed only (`scheduledDays()`).
- Leave counts working days on the person's own calendar, leaving out weekly offs and holidays (BR-27). A request that covers only days off is refused with "These days are all weekly offs or holidays".
- Payroll estimates count the calendar's working days in a month (BR-26).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No holidays this year | Nothing is loaded for that year yet. | Add them one by one. |
| Some details need fixing. Check the highlighted fields. | The date or name broke a rule; the reason shows under the field. | Fix it and add again. |
| This feature is switched off for your organisation. | **Leave and attendance** is off. | Switch it on in **Settings** › **Organisation** › **Modules**, if your plan includes it (see [Switch modules on and off](modules.md)). |
| A person's attendance shows a holiday they don't have | They are on the wrong calendar, or the default. | Change their **Holiday calendar** on their page. |
