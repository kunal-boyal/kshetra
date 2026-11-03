# Attendance and leave

| | |
|---|---|
| **Who** | Field user, Manager (attendance: `shift.use`; asking to fix a day: `regularisation.request`; leave: `leave.request`) |
| **Where** | Field app › **More** › **Attendance**; Field app › **More** › **Leave**; **Home** › **Ask for leave** |
| **Module** | Core for the attendance month; Leave and attendance for leave and fixing days |
| **Related** | [Start your day](start-your-day.md), [Use the upload queue](upload-queue.md) |

Your attendance comes from your shifts, leave, holidays and weekly offs. You can see your month, ask to fix a day the system counted wrong (a regularisation), see your leave balances and ask for leave.

## Before you start

- Your month and your leave balances are kept on the phone with when they were read, so they show offline. Requests wait on the phone and upload when there is signal.
- Leave types, quotas and holidays come from your organisation's calendar and policies.

## Steps

### See your month

1. Open **More** › **Attendance**. The row says how many days are left to fix (**… days to fix**).
2. The month shows as a calendar, each day coloured by its status: **Present**, **Half day**, **Leave**, **Absent, to fix** or **Off or holiday**. The top says **Working days … · Paid days …** and **As of …**.
3. Move with **Previous month** and **Next month**.
4. **Tap a day to see it, or to ask to fix it.** The day shows its status (such as **Present**, **Absent**, **Paid leave**, **Weekly off**, **Holiday**), its hours on duty (**… hours on duty**), any holiday (**Holiday: …**) and any request to fix it.

### Ask to fix a day

1. Tap the day on **Attendance**. A day can be asked about when it has passed or is today, you were employed, it isn't counted present already, and no request for it is waiting or approved.
2. Under **Fix this day**, choose **Count it as** **Present** or **Half day**.
3. Write the **Reason**: what you were doing that day, 3 to 600 characters.
4. Tap **Ask to fix this day**.
5. The day says **Asked to count it as …; sends when there is signal** until it uploads, then **Asked to count it as …; waiting for approval**, and **Counted as …, approved** once approved. Your manager, or the chain your organisation set, decides it; only an approved request changes the day.

### See your leave

1. Open **More** › **Leave**. The row there says how many days of paid leave are left (**… days left**).
2. **Balances** shows each type with **… of … left** (or **No limit**), and, where your organisation credits leave monthly or carries it forward, **… credited so far**, **… carried in**, **… taken** and **… waiting**.
3. **Requests this year** lists your requests with their dates and state; one still on the phone says **Sends when there is signal**.
4. On **Attendance**, **Leave left this year** shows the first three paid types, with **Apply**.

### Ask for leave

1. Tap **Ask for leave** on **Home**, on **Leave**, or **Apply** on **Attendance**.
2. Under **Leave type**, choose a type; each shows **… left**.
3. **Tap the first day, then the last. Days off are dimmed.**
4. For a single day of a type that allows it, choose **Whole day** or **Half day** under **How much of the day**.
5. The screen counts the working days (**… working days**), leaving out weekly offs and holidays on your calendar.
6. If leave this long needs a document, it says **Leave this long needs a document, such as a doctor's note.** Tap **Photograph the document**.
7. Add a **Reason** if you like (optional, up to 600 characters).
8. **Who decides** shows who will approve it.
9. Tap **Send the request**.

## What the system checks

- A day's status follows BR-23 in order: not yet come, outside employment, present (a shift that day, or an approved fix), half day, paid leave, unpaid leave, holiday, weekly off, then absent (`dayStatus()`). Presence wins over leave on the same day. Working days and paid days count from the calendar (BR-24, BR-25).
- A day to fix can't be in the future or before you joined, and the reason runs from 3 to 600 characters (BR-28, `regularisationIssue()`). One waiting or approved request a day.
- Leave counts working days on your own calendar; a holiday or weekly off is never taken as leave (BR-27, `leaveDays()`).
- A request is refused when its type is off, it ends before it starts, it runs over a year, a half day isn't allowed or covers more than one day, it covers no working day, it needs a document and has none, it overlaps leave you already have, or it is more than you have left (BR-27, `leaveIssues()`).
- Where leave is credited monthly, you may take only what is credited by the start day plus what was carried in (decision D114).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Write at least 3 characters** | The reason to fix a day is too short | Write more |
| **End on or after the first day** | The last day is before the first | Pick the days again |
| **Ask for a year or less at a time** | The request is too long | Split it |
| **This leave type has no half days** / **A half day is one day; choose one day** | A half day isn't possible here | Choose a whole day, or a single day |
| **These days are all weekly offs or holidays** | Nothing to take leave from | Pick working days |
| **Attach a document for leave this long** | A document is needed | Tap **Photograph the document** |
| **You have leave on some of these days already** | Overlaps another request | Change the days |
| **This is more than the days left this year** | Over your balance | Ask for fewer days, or another type |
| **This leave type is switched off** | The type was switched off | Choose another type |
| No **Leave** on **More** | The Leave and attendance module is off | Ask your admin |
