# Find out why a notification didn't arrive

| | |
|---|---|
| **Who** | The person expecting it; the tenant's admin (`settings.manage`); vendor support |
| **Where** | Field app › **Home** › the bell › **Notifications**; web portal › **Notifications**, **Settings** › **Rules** › **Notifications** |
| **Module** | Core |
| **Related** | [Notifications and search](../field/notifications-and-search.md), [Sign-in and sessions](sign-in-and-sessions.md), [GPS and geofences](gps-and-geofences.md) |

Every notification lands in the person's inbox in the app and the portal. Most also go out by one more channel: a push to the phone, then WhatsApp, SMS or email where the event lists them. Start with the inbox: if it is there, the notification was made and only the delivery outside the app is in question.

## Before you start

- Ask the person to open the inbox: on the phone, the bell on **Home** (**Notifications, … unread**); on the web, **Notifications**. If the notification is there, it was made; go to "It is in the inbox but never reached the phone".
- If it isn't there, check the event happened for this person: a decision on their request, a rejected form, today's plan at the plan time, and so on. Notifications go to the person the event concerns.

## How each event travels

The inbox entry comes first. Then the event's channels are tried in order, and the first that reaches the person ends the list; a channel that can't reach them (no phone registered for push, no number or email on record, no WhatsApp consent) hands on to the next.

| Event | Category in **What I hear about** | Channels after the inbox |
|---|---|---|
| Today's plan | **Today's plan** | Push, then WhatsApp, then SMS |
| A request waits for your decision | **Approvals** | Push, then WhatsApp |
| Your request was decided, your data request was answered | **Approvals** | Push |
| Your form was rejected, your collection was rejected or bounced | **Rejected forms** | Push |
| Your targets were locked | **Targets** (the tenant's word) | None |
| Your location stopped (20 minutes), no location from someone you manage (40 minutes) | **Tracking stopped** | Push |
| An import finished, a scheduled report is ready, the ERP needs connecting again | **Imports** | Email |
| An export is ready | **Imports** | None |
| Vendor support asks to enter, or entered in an emergency | **Vendor support** | Email |
| A personal data request arrived or is due soon | **Approvals** | Email |

## What you see, and what to do

### It isn't in the inbox

| Why | What to do |
|---|---|
| The event didn't happen for this person, or hasn't happened yet | Check the request, form or plan itself. |
| Old notifications were removed | The inbox keeps notifications for **Keep notifications for** (90 days by default, **Settings** › **Rules** › **Keeping records**). |
| The phone has no signal | The inbox is read online. Open it again with signal; if it shows an error, tap **Try again**. |

### It is in the inbox but never reached the phone

| Why | What to do |
|---|---|
| The person muted its category | **What I hear about** on the notifications screen: a ticked category comes to the phone or by email; an unticked one shows only in the inbox ("Untick what you don't want on your phone or by email; it still shows here. Approvals and tracking alerts always come."). Tick it and tap **Save**. **Approvals**, **Tracking stopped** and **Vendor support** can't be muted (**Always on**). |
| Quiet hours | Pushes, WhatsApp and SMS that aren't urgent wait until quiet hours end: "Quiet hours run from … to …. Urgent messages still come through." The admin sets **Quiet hours start** and **Quiet hours end** (21:00 to 07:00 by default) under **Settings** › **Rules** › **Notifications**. The tracking alerts and vendor support's emergency entry are urgent. Email isn't held. |
| The phone isn't registered for push | The app registers the phone once signed in, after the person allows notifications. If they refused, open the phone's settings for the app and allow notifications, then open the app again with signal. On Android, the app's notification channel is called **Notifications**. |
| The app can't receive push at all | Push needs a development build of the app with the Firebase configuration. Expo Go, an emulator and the app in a browser register nothing. |
| The phone's maker stops the app in the background | Follow **Keep your route recorded**'s steps for the phone's maker ([GPS and geofences](gps-and-geofences.md)); the same battery settings stop notifications. |
| The event has no channel outside the app | Some events, such as an export being ready or targets locked, only go to the inbox (table above). |
| The person was signed in on another phone | Push goes to every phone that has registered for the person and is still signed in. A phone that signed out, whose session ended or ran out, or that was reset gets no more pushes, and its registration is removed. The new phone registers when the person signs in on it. |
| The person was signed out | Signing out, **Sign out everywhere**, **Sign out everyone**, a phone reset, an authenticator reset or making the person inactive stops their pushes until they sign in again on a phone; the inbox still has every notification. |

A push counts as sent once the push service accepts it. Whether the phone then showed it depends on the phone; the server can't see that.

### WhatsApp messages don't come

On the notifications screen, **WhatsApp messages** shows the consent text and where the person stands:

| What it says | What to do |
|---|---|
| **You haven't agreed, so nothing comes on WhatsApp.** | The person taps **Agree to WhatsApp messages** if they want them. |
| **The text changed since you agreed. Agree again to keep receiving messages.** | The consent wording changed; they agree again. |
| **WhatsApp isn't switched on yet; your answer is kept for when it is.** | WhatsApp isn't available on this server; nothing is sent by WhatsApp. Push, SMS or email carry on as the event lists. |
| **You agreed on ….** | WhatsApp reaches them for today's plan and requests waiting for their decision, in the template approved for the event and language. **Stop WhatsApp messages** ends it. |

WhatsApp goes to the mobile number the organisation has for the person.

### Emails don't come

- The email goes to the **Email** on the person's page under **People**. With none, email is skipped, and nothing else is tried for that event.
- Emails are in the organisation's first language, and carry a link to the portal, never the data itself.
- Ask the person to check their spam folder.

### SMS doesn't come

Only today's plan goes by SMS, and only after push and WhatsApp couldn't reach the person. SMS in India goes only in templates registered under DLT, one per event and language.

## What the system checks

- Each event's category, channels and urgency are fixed (`NOTIFICATION_KINDS`, M16). A muted category keeps its inbox entry and sends nothing else; approvals, tracking and vendor support can't be muted.
- Quiet hours hold non-urgent push, WhatsApp and SMS until they end; email is never held.
- WhatsApp needs the person's consent to the current text, and an approved template for the event and language (decision D85).
- A notification is sent once, however often its event is delivered.

## Waiting on the owner

- Push needs a development build and Firebase's configuration for the build; until a development build is installed, phones get nothing by push.
- WhatsApp is off in production until a WhatsApp Business number and a provider account exist (D12).
- SMS notifications need MSG91 with DLT registration and a template for each event and language.
- Amazon SES is in its sandbox, so email reaches only verified addresses until it leaves it.
- Admins and support can't see from the portal or the console whether a notification's push, SMS or email went out; the outcome is recorded only on the server.
