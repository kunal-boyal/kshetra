# Troubleshooting

For anyone helping a person who is stuck: the tenant's admin, a manager, the vendor's support team, and people themselves. Each procedure starts from what the person sees, says why it happens and what fixes it. Ask for the exact sentence on the screen, and whether it is the phone or the web; then find it in the table below or in the procedure for the area.

| Procedure | What it covers | Who |
|---|---|---|
| [Sign-in and sessions](sign-in-and-sessions.md) | Codes that don't arrive or are refused, a number in use elsewhere, a new phone, a lost authenticator, single sign-on, being signed out, step-up, updating the app | Everyone, admins, vendor support |
| [Upload queue and sync](upload-queue-and-sync.md) | The banner on Home, items waiting or refused and what each refusal means, pricing an order again, refreshing the phone's copies, signing out with records not uploaded | Field people, managers, admins |
| [GPS and geofences](gps-and-geofences.md) | Location not found, the route not recorded and each phone maker's battery settings, refused points, fake locations, the phone's clock, geofences, the flags reviewers see | Field people, managers, admins |
| [Photos](photos.md) | The camera, photos waiting to upload, empty photo tiles, repeated and gallery photos, photos past their keeping time | Field people, reviewers, admins |
| [Access and modules](access-and-modules.md) | No access, outside your scope, not found, a module switched off, read only and suspended, vendor support's access, a move between servers, seats, too many requests | Everyone, admins, vendor support |
| [Notifications](notifications.md) | How each notification travels, why one didn't arrive by push, WhatsApp, email or SMS | Everyone, admins |

## Every message a person can meet

The apps show one sentence for each error code the server gives, in the reader's language (spec 11.4, `error.*` in `packages/i18n`). The server's own, more precise words are English and are mostly not shown. Words in the sentences that depend on the tenant are shown with their defaults: account, order, target, sell-through, **Start day**.

| Code | What the person sees | Covered in |
|---|---|---|
| (no connection) | The server could not be reached. Check your connection, then try again. | [Upload queue and sync](upload-queue-and-sync.md) |
| `VALIDATION` | Some details need fixing. Check the highlighted fields. On the sign-in screen: Enter a 10-digit mobile number, such as 98765 43210. | [Upload queue and sync](upload-queue-and-sync.md), [Photos](photos.md), [Sign-in and sessions](sign-in-and-sessions.md) |
| `UNAUTHENTICATED` | Sign in to continue. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `TOKEN_EXPIRED` | Your session needs refreshing. Try again. The apps refresh by themselves; try again if it shows. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `SESSION_REVOKED` | You have been signed out. Sign in again. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `FORBIDDEN` | You don't have access to this. | [Access and modules](access-and-modules.md) |
| `OUT_OF_SCOPE` | This is outside the people and places you look after. | [Access and modules](access-and-modules.md) |
| `MODULE_DISABLED` | This feature is switched off for your organisation. | [Access and modules](access-and-modules.md) |
| `USE_MOBILE_APP` | Use the mobile app for this. | [Access and modules](access-and-modules.md), [Sign-in and sessions](sign-in-and-sessions.md) |
| `NOT_FOUND` | This was not found. It may have been removed. | [Access and modules](access-and-modules.md) |
| `CONFLICT` | This changed somewhere else. Refresh and try again. Where the server gives a reason, the portal shows it instead, such as "This mobile number is already in use. …" for a number in use in another organisation, "People still report to this person. …" on deactivating a manager, or "Another organisation has verified this domain already."; someone with no authenticator asked to confirm a change is sent to set one up. | [Upload queue and sync](upload-queue-and-sync.md), [Sign-in and sessions](sign-in-and-sessions.md) |
| `IDEMPOTENCY_CONFLICT` | This request was already sent with different details. Start it again. | [Upload queue and sync](upload-queue-and-sync.md) |
| `DEVICE_NOT_BOUND` | This phone is not registered for your account. Ask your manager to reset your device. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `ALREADY_PUNCHED_IN` | Your day has already started. | [Upload queue and sync](upload-queue-and-sync.md) |
| `NOT_ON_SHIFT` | You are not on duty. Tap Start day first. | [Upload queue and sync](upload-queue-and-sync.md) |
| `OUTSIDE_SHIFT` | This was recorded outside your duty hours, so it cannot be saved. | [Upload queue and sync](upload-queue-and-sync.md) |
| `SHIFT_EXPIRED` | Your day passed the longest allowed shift and was closed. | [Upload queue and sync](upload-queue-and-sync.md) |
| `GPS_MOCKED` | Your location looks simulated. Turn off any app that changes your location, then try again. | [GPS and geofences](gps-and-geofences.md) |
| `GPS_STALE` | Your location is out of date. Wait for a fresh fix, then try again. | [GPS and geofences](gps-and-geofences.md) |
| `GPS_INACCURATE` | Your location is not accurate enough. Move into the open, then try again. | [GPS and geofences](gps-and-geofences.md) |
| `OUTSIDE_GEOFENCE` | You are too far from this account. | [GPS and geofences](gps-and-geofences.md) |
| `SYNC_WINDOW` | This was recorded too long ago to be counted. | [Upload queue and sync](upload-queue-and-sync.md) |
| `PHOTO_REQUIRED` | Add a photo to continue. | [Upload queue and sync](upload-queue-and-sync.md) |
| `MEDIA_NOT_READY` | A photo is still uploading. This will retry by itself. | [Photos](photos.md) |
| `PRICE_CHANGED` | Prices have changed. Check your cart, then send the order again. | [Upload queue and sync](upload-queue-and-sync.md) |
| `TARGET_LOCKED` | This target is locked and can no longer be changed. A locked target changes only after it is unlocked; see the manager's targets procedure. | [../manager/](../manager/README.md) |
| `PERIOD_CLOSED` | That month is closed. Its sell-through can no longer change. Shown for a closed forecast month too. | [Upload queue and sync](upload-queue-and-sync.md) |
| `NOT_CURRENT_APPROVER` | It isn't your turn to act on this, or someone else already has. Refresh your inbox. | [../manager/](../manager/README.md) |
| `QUOTA_EXCEEDED` | This is over your limit. | [Upload queue and sync](upload-queue-and-sync.md) |
| `IMPORT_ERRORS` | Some rows have errors. Fix them, then upload the file again. The row errors list each problem. | [../admin/](../admin/README.md) |
| `SEAT_LIMIT` | Your organisation has used all its seats. Ask an admin to add more. | [Access and modules](access-and-modules.md) |
| `TENANT_READ_ONLY` | Your organisation's subscription is read-only for now. Ask an admin about billing. | [Access and modules](access-and-modules.md) |
| `TENANT_SUSPENDED` | Your organisation's subscription is suspended. Ask an admin about billing. | [Access and modules](access-and-modules.md) |
| `TENANT_MOVING` | Your organisation is being moved to a new server. You can look around; changes can be made again shortly. | [Access and modules](access-and-modules.md) |
| `TENANT_MOVED` | Your organisation has moved to a new server. Try again. | [Upload queue and sync](upload-queue-and-sync.md) |
| `RATE_LIMITED` | Too many attempts. Wait a moment, then try again. | [Access and modules](access-and-modules.md), [Sign-in and sessions](sign-in-and-sessions.md) |
| `REPORT_TIMEOUT` | This took too long to read. Narrow it down, or export it instead. Choose a smaller team or one person, or use the report's export, which runs in the background. | [../back-office/](../back-office/README.md) |
| `SYNC_RESET` | Your phone needs a full refresh. It is starting now. The phone does it by itself. | [Upload queue and sync](upload-queue-and-sync.md) |
| `OTP_INVALID` | That code is not right. Check it and try again. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `OTP_EXPIRED` | This code has expired. Ask for a new one. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `SECOND_FACTOR_REQUIRED` | Sign in again with your authenticator to open this organisation. Seen when a change that needs the authenticator was cancelled. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `SSO_REQUIRED` | Your organisation signs you in with its own sign-in. Enter your work email to continue. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `SUPPORT_READ_ONLY` | Your support access lets you look, not change anything. | [Access and modules](access-and-modules.md) |
| `UPGRADE_REQUIRED` | Update the app to continue. The phone shows **Update the app** instead of its screens. | [Sign-in and sessions](sign-in-and-sessions.md) |
| `ERP_NOT_CONFIGURED` | This server isn't set up to connect to that ERP yet. The vendor hasn't set this server up for that ERP. | [../admin/](../admin/README.md) |
| `ERP_REFUSED` | The ERP refused the request. Try connecting again. | [../admin/](../admin/README.md) |
| `INTERNAL` | Something went wrong. Try again in a moment. If it keeps happening, note the time and tell vendor support. | |

The phone's upload queue has two reasons of its own:

| Reason | What the person sees | Covered in |
|---|---|---|
| `DEPENDENCY_DISCARDED` | Something this record needed was discarded, so it can't upload. Discard it too. | [Upload queue and sync](upload-queue-and-sync.md) |
| `UNKNOWN_KIND` | This version of the app can't upload this record. Update the app. | [Upload queue and sync](upload-queue-and-sync.md) |

Sign-in by single sign-on can come back with one of five reasons, shown on the sign-in page; they are in [Sign-in and sessions](sign-in-and-sessions.md).

## Before you escalate to vendor support

- Note the exact sentence, the time, the person, and whether it was the phone or the web.
- For a phone, note what **People** › the person › **Phone** shows: **App version**, **Last seen**, **Last sync** and **Waiting to upload**.
- Vendor support sees inside the organisation only under a grant its admin approves at **Settings** › **Vendor support**.
