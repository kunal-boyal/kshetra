# Announce something to tenants

| | |
|---|---|
| **Who** | Implementation or Platform admin (`platform.tenant.manage`); every staff member reads announcements |
| **Where** | Console › **Announcements** (under **Operations**) |
| **Related** | [Read cell health](cell-health.md), [docs/runbooks/incident-response.md](../../runbooks/incident-response.md) |

Tell tenants something in their portal, on their phones or both, for a while: planned maintenance, an incident and its recovery, a new feature. It reaches every tenant or the ones you choose, and everyone signed in there sees it until it ends or they dismiss it.

## Before you start

- Write the message in English and in Hindi. Both are required. Keep the title short (80 characters at most) and the message to 500.
- Decide the window. It shows for at most 31 days.
- For an incident, an announcement doesn't replace the email to the customers' admins that [incident response](../../runbooks/incident-response.md) asks for; it adds to it.

## Announce

1. Open **Announcements**. The table lists what was announced, with **Title**, **Kind**, **Where**, **Who**, **When** and **Status** (Scheduled, Showing, Ended or Withdrawn).
2. Under **New announcement**, enter **Title in English**, **Title in Hindi**, **Message in English** and **Message in Hindi**.
3. Choose **Kind**: **Information** or **Warning**.
4. Under **Where it shows**, tick **Web portal**, **Phones** or both.
5. Choose **Who**: **Every tenant**, or **Only these tenants**. For some tenants, type in **Find a tenant** and tick each one; ticked tenants stay listed as you search for more.
6. Set **Starts** and **Ends**, in your own time zone. Both start as now and a day from now.
7. Select **Announce**. The form says "Announced." and the announcement joins the table, Scheduled until it starts, then Showing.

## Withdraw an announcement

1. In the announcement's row (Scheduled or Showing), select **Withdraw**.
2. The console asks "Take “{title}” down now? Nobody sees it any more." Select **Withdraw** again, or **Cancel**.

## What tenants see

- In the portal, the announcement shows on every screen, in the reader's language, with **Dismiss**.
- On the phone, it shows on Home, with a close button.
- A dismissal stays in that browser or on that phone only: the same person sees it again on another device.

## What the system checks

- Both languages of the title and message are filled; at least one place is chosen; for some tenants, at least one (200 at most) is chosen and each exists.
- It ends after it starts, and shows for 31 days at most.
- The form names the announcement once, so selecting **Announce** twice makes one announcement.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Under **Ends**: "End after it starts" | The end is at or before the start | Move the end later |
| Under **Ends**: "Show it for 31 days at most" | The window is longer than 31 days | Shorten it, and announce again later if needed |
| **Announce** stays greyed out | A title or message in one language is empty, no place is ticked, or **Only these tenants** has none ticked | Fill in what is missing |
| You don't see **New announcement** | Your role can only read announcements | Ask Implementation or a platform admin |
