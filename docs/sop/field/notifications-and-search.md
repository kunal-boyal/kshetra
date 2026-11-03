# Notifications and search

| | |
|---|---|
| **Who** | Everyone using the field app |
| **Where** | Field app › **Home** › the bell; Field app › **Home** › the search button; announcements at the top of **Home** |
| **Module** | Core |
| **Related** | [Use the upload queue](upload-queue.md), [Attendance and leave](leave-and-attendance.md), [Claim an expense](claim-expenses.md) |

The app tells you when something needs you or was decided: a request approved or rejected, a form rejected, a collection turned down, tracking that stopped. Notifications come as push messages on the phone and wait in the inbox. Search finds a screen, an account or a person on the phone.

## Before you start

- The first time you are signed in, the phone asks whether the app may show notifications. Allow it to get push messages.
- The inbox and your notification choices need signal. Search works offline.

## Steps

### Open a notification

1. Tap a push notification on the phone. The app opens where it leads (such as **Attendance**, **Leave**, **Expenses**, **My collections**, **Upload queue** or **My data**); anything else opens the inbox.
2. Or, on **Home**, tap the bell. Its count is how many are unread.
3. **Notifications** lists them newest first under **Today** and **Earlier**, unread ones marked **Unread**. Tap one to mark it read and go where it leads.
4. Tap **Mark all read** to clear the count. **Load more** shows older ones.
5. The inbox says when your organisation's quiet hours run (**Quiet hours run from … to …. Urgent messages still come through.**).

### Choose what you hear about

1. At the foot of **Notifications**, under **What I hear about**, untick what you don't want on your phone or by email, such as **Today's plan**, **Rejected forms**, **Targets** or **Imports**.
2. Tap **Save**. It says **Saved.**

**Untick what you don’t want on your phone or by email; it still shows here. Approvals and tracking alerts always come.**

### WhatsApp messages

1. Under **WhatsApp messages**, read the text you would agree to.
2. Tap **Agree to WhatsApp messages**, or **Stop WhatsApp messages** to stop. It says when you agreed (**You agreed on ….**), or **You haven't agreed, so nothing comes on WhatsApp.**
3. If the text changed since you agreed, it says **The text changed since you agreed. Agree again to keep receiving messages.**

### Search

1. On **Home**, tap the search button (**Search**).
2. Type part of a name in the box (**Search screens, people and accounts**). Your orders aren't searched here; they are in the **Orders** tab. Results come under **Screens** (the screens you may open), **Accounts** (the tenant's word) and, for managers who may replay a person's day, **People**.
3. Tap a result to open it. **The phone searches the screens you can open and the people and accounts it keeps, even without signal.**

### Announcements

The vendor sometimes announces something to your organisation, such as planned maintenance. Announcements show at the top of **Home** under **Announcements**: a warning in amber, information in blue, each until it ends. Tap the cross (**Dismiss “…”**) to hide one on this phone.

## What the system checks

- Each notification goes by push first, then the next channel your organisation set when push can't reach you.
- Approvals and tracking alerts can't be muted.
- WhatsApp reaches you only if you agreed to the current text, and only in approved message templates.
- Search keeps to what you may see: the screens your permissions and modules allow, and the accounts and people kept on the phone.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| No push messages | Notifications are off for the app, or this build can't receive push | Allow notifications in the phone's settings; check the inbox |
| **Nothing yet** | No notifications | Nothing to do |
| **Nothing matches “…”.** | Search found nothing | Try another part of the name |
| **WhatsApp isn't switched on yet; your answer is kept for when it is.** | Your organisation has no WhatsApp provider yet | Nothing to do |
| **The server could not be reached. Check your connection, then try again.** | The inbox needs signal | Move to signal and **Try again** |

## Waiting on the owner

- Push needs a development or production build with Firebase's configuration; Expo Go can't receive it.
- WhatsApp is off until your organisation's vendor has a WhatsApp Business number and a provider account.
- SMS notifications need MSG91 with DLT templates.
