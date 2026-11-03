# Read cell health

| | |
|---|---|
| **Who** | Every vendor staff member |
| **Where** | Console › **Health** (under **Operations**) |
| **Related** | [docs/runbooks/incident-response.md](../../runbooks/incident-response.md), [Announce something to tenants](announcements.md) |

Each cell (the servers and database a group of tenants lives on) reports every minute: its last minute, what needs looking at, and its last day by the hour. Look here when a customer reports something slow or missing, and before telling customers all is well. The page reads; it changes nothing. The cell's alarms in AWS are separate, and remain the way an incident is noticed out of hours.

## Steps

1. Open **Health**. The **Cells** table has a row a cell: its name, region and whether it is shared or dedicated, its **Tenants**, its **Last minute** ("{requests} requests · {errors} errors"), **Jobs waiting**, **With uploads waiting**, **Last report** and **Status**:
   - **Healthy**: nothing needs looking at.
   - **Needs looking at**: one or more issues, listed on the cell's card.
   - **Silent**: the cell hasn't reported for 3 minutes or more.
2. Below the table each cell has a card, headed "Nothing needs looking at." or **Needs looking at** with its issues listed, and "Last minute reported:" with the time.
3. Read the card's figures for its last minute (the table below).
4. Read **Queues**: each queue with **Waiting**, **Running**, **Later**, **Failed** and **Oldest wait**.
5. Read **The last day, by the hour**: for each **Hour**, **Requests**, **Server errors**, **Points**, **Late**, **Worst queue wait**, **Oldest upload** and **Minutes reported** (60 when the cell reported every minute).
6. If an issue shows, follow the table at the end, and open [incident response](../../runbooks/incident-response.md) when people can't work.

## The figures

| Figure | What it counts |
|---|---|
| **Requests** | Requests the cell answered in the minute |
| **Server errors** | Of them, answered with a server error |
| **Location points received** | Location points accepted from phones |
| **Of them more than 2 minutes late** | Points that arrived more than 2 minutes after they were captured, usually phones catching up after no signal |
| **Events not yet delivered** | Events in the outbox waiting to be handed to their consumers (notifications, metrics, webhooks) |
| **Oldest of them** | How long the oldest of those has waited |
| **Phones heard from in the last half hour** | Phones that synced recently |
| **With uploads waiting** | Of them, phones with records still in their upload queue |
| **With uploads refused** | Of them, phones with an upload the server refused, parked for the person to look at |
| **Oldest upload waiting** | The oldest record still waiting on one of those phones |

The queues are `maintenance`, `imports`, `media`, `notifications`, `exports`, `webhooks` and `connectors`. **Later** counts jobs scheduled or retried for later; **Failed**, jobs that used up their tries.

## The issues

| Issue | What it means | What to do |
|---|---|---|
| Not reporting for 3 minutes or more | The scheduler that reports has stopped, or the cell is down | Check whether people can sign in; this is likely an incident. Check the cell's services and alarms in AWS |
| Server errors above 2% of requests | More than 2 in 100 requests failed in the minute (only counted from 50 requests a minute) | Check the API's log for the errors; consider a rollback if it follows a deploy |
| Jobs waiting more than 5 minutes in {queue} | The named queue's oldest job has waited over 5 minutes | Check the worker is running; imports, exports and notifications in that queue are delayed |
| Events undelivered for more than 5 minutes | The outbox is behind: notifications, metric updates and webhooks lag | Check the worker and the API's log |
| Phones with uploads waiting more than an hour | A phone seen in the last half hour still holds a record over an hour old | Usually one person's phone holding an upload that keeps failing or was refused; the person opens the upload queue on the phone ([troubleshooting](../troubleshooting/README.md)). Many phones at once point to a server problem |

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No cells yet. | No cell has reported | Check the scheduler is running on the cell |
| This cell has not reported yet. | The cell is listed but never reported | Check its scheduler started |
| The server could not be reached. Check your connection, then try again. | The console can't reach the API | Check your connection; if others see the same, treat it as an incident |
