# Answer a personal data request

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`) |
| **Where** | Web portal › **Settings** › **Data** › **Data requests** |
| **Module** | Core |
| **Related** | [Add and look after people](people.md), [Read the audit log](audit-log.md), [Export all your organisation's data](data-export.md) |

People may ask for a copy of their personal data, for a correction, or for its erasure once they have left. They ask on their phone, or by email, letter or in person, in which case you log the request here. Answer each within 30 days.

## Before you start

- Everyone holding `settings.manage` gets **A personal data request arrived** when a request is raised on a phone or logged here, and **A personal data request is due soon** a week before it is due.
- For an erasure, the person must already be deactivated ([Add and look after people](people.md)).

## Steps

### Log a request made outside the app

1. Open **Settings** › **Data** › **Data requests**.
2. Under **Log a request**, choose the **Person** (anyone, leavers included).
3. Choose the **Request**: **A copy of their data**, **A correction** or **Erasure**.
4. Under **What they asked**, write what they asked for.
5. Select **Log request**. It appears under **Open**.

### Open a request

1. Under **Open**, requests are listed by when they are due, as the person's name and the request, with **Due {date}**, or **Overdue since {date}** in red.
2. Select one. Its page says who raised it and when (**Raised by them on {date}** or **Logged by {name} on {date}**) and **What they said: {details}**.

### A copy of their data

1. Under **Answer to them**, select **Prepare their archive**. The page says **Their archive is being prepared**, then **Their archive is ready**.
2. To check it, select **Download their archive**. It holds every record that refers to them.
3. In **Answer to them**, write what you did. They see it on their phone.
4. Select **Mark done**. They get **Your data request is done** and download it themselves from **More** › **My data** › **Download my copy** on their phone, while the archive is kept.
5. For someone who can't sign in (a leaver, or a request logged for someone without the app), download it and send it to them yourself, safely.

Each download link lasts 24 hours, and the archive is kept 7 days from when it was prepared, so mark the request done soon after preparing it. Every download, yours or theirs, is in the audit log as `data_request.downloaded`.

### A correction

1. Select **Open their profile**, make the change, and save it.
2. Back on the request, write what you changed in **Answer to them**.
3. Select **Mark done**.

### Erasure

1. Check they have left and are deactivated.
2. Write what you did in **Answer to them**.
3. Select **Erase their data**, then **Erase their data** again to confirm. Their name, contact details, locations, selfies and notifications go for good; the records of their work stay, without their name. This can't be undone.

### Refuse a request

1. Write why in **Answer to them**.
2. Select **Refuse**.

Answered requests move to **Answered**, with the **Answer**, when and by whom, and **What they were told**.

## What the system checks

- A request is due 30 days after it arrives; a reminder goes 7 days before (`dataRequestDueOn()`, `dataRequestReminderDue()`).
- An access request can't be marked done before its archive is prepared.
- The person's own download is offered only to them, only once the request is marked done, and only while the archive is kept (D141).
- A refusal must say why.
- Erasure needs the person deactivated first (`dataRequestCloseIssue()`).
- A closed request can't be closed again.
- Every step is in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Prepare their archive first** | You marked an access request done without its archive. | Select **Prepare their archive**, then **Mark done** once it is ready. |
| **Say why it is refused** under **Answer to them** | You refused without a reason. | Write the reason and select **Refuse** again. |
| **Deactivate them before erasing their data** | The person is still active. | Deactivate them ([Add and look after people](people.md)), then erase. |
| Their archive could not be prepared | The archive failed. | Select **Prepare their archive** again; if it fails again, tell the vendor. |
| Their archive was removed | The 7 days have passed. | Prepare it again. |

The bold messages come from the server, in English.

## Waiting on the owner

- Problems the server describes come in English only (D42).
- Email notifications need Amazon SES out of its sandbox in production; until then rely on the in-app inbox.
