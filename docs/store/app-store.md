# App Store

What App Store Connect asks for The Lamp's iPhone app (decision D100: Play first, iOS ready). Nothing here can be submitted until the company has an Apple developer account (D-U-N-S, decision D1); the build settings it relies on are already in `apps/mobile/app.config.ts`. Keep these answers true of the app, as for [google-play.md](google-play.md).

## The build

| Setting | Where | Value |
|---|---|---|
| Bundle ID | `app.config.ts`, from `product.json` | `com.thelamp.app` |
| Purpose strings | `expo-location` and `expo-camera` plugins in `app.config.ts` | Location when in use: sorting nearby places and recording where a place is. Location always: recording location while on duty, screen off too, until punch-out. Camera: photos of work |
| Background modes | `ios.infoPlist.UIBackgroundModes` | `location` (the shift's route), `remote-notification` (push) |
| Privacy manifest | `ios.privacyManifests` | No tracking; the required-reason APIs React Native reads; Expo's modules carry their own |
| Export compliance | `ios.config.usesNonExemptEncryption: false` | Only HTTPS and the system's encryption, which are exempt, so Connect asks nothing |
| Tablets | `ios.supportsTablet: false` | iPhone only |
| Build | EAS on Kunal's account | `eas build --profile production --platform ios`, then `eas submit --platform ios` once the account and its App Store Connect app exist |

## Distribution

The public App Store, with a review account, as on Play. If Apple asks that an app for organisations' own staff be distributed privately (App Review Guideline 3.2), the fallback is custom apps through Apple Business Manager, one per customer organisation, as spec 13.4 allows.

## App information

| Field | English | Hindi |
|---|---|---|
| Name (30) | The Lamp | The Lamp |
| Subtitle (30) | Field work, seen clearly | मैदान का हर काम, साफ़ नज़र |
| Promotional text (170) | Attendance, visits, orders and expenses for field teams, in English and Hindi, even offline. | फ़ील्ड टीमों के लिए हाज़िरी, विज़िट, ऑर्डर और खर्च, हिंदी और अंग्रेज़ी में, ऑफ़लाइन भी। |
| Keywords (100) | field sales,attendance,visits,orders,expenses,field force,sales team,leave,beat plan,GPS | फ़ील्ड सेल्स,हाज़िरी,विज़िट,ऑर्डर,खर्च,बिक्री टीम,छुट्टी |
| Description | The Play full description in [google-play.md](google-play.md), as it stands | The same, in Hindi |
| Category | Business; secondary Productivity | |
| Age rating | 4+: no objectionable content | |
| Privacy policy URL | `https://<web_domain>/privacy` | |
| Support URL | The company's support page, once it exists | |

Screenshots: 6.9-inch iPhone (1,320 x 2,868), the same six screens as Play's, in English and Hindi, from a production build on the simulator signed in to the review tenant.

## App privacy

Tracking: **no**: nothing is linked to data from other companies' apps or sites, and no data broker receives any.

| Data type | Linked to the user | Used for tracking | Purposes |
|---|---|---|---|
| Contact info: name, email address, phone number | Yes | No | App functionality |
| Location: precise and coarse | Yes | No | App functionality |
| User content: photos | Yes | No | App functionality |
| User content: other user content (visits, forms, orders, requests) | Yes | No | App functionality |
| Financial info: other financial info (expense claims) | Yes | No | App functionality |
| Identifiers: user ID, device ID (the app's own random key) | Yes | No | App functionality |
| Diagnostics: crash data, once error reporting is on | No | No | App functionality |

## App Review information

**Sign-in:** the review tenant's field user and manager, with their demo codes, as in [google-play.md](google-play.md#review-account).

**Notes:**

```text
The Lamp is a work app for organisations' field teams. People sign in with a mobile number their organisation has added; the account above is in a demonstration organisation with fictional data, and its fixed code stands in for the SMS code.

Location "Always": the app records location in the background only during a shift the person starts, from Punch in to Punch out, so their organisation sees attendance, visits and routes. The consent sheet at Punch in explains this before iOS asks. To see it, tap Punch in on Home, allow location, and tap Punch out to stop. Outside a shift the app never records location.

Camera: photos of work, receipts and odometers, taken in the app. The app shows no ads and does no tracking.
```

## Waiting for

| What | Who |
|---|---|
| An Apple developer account for the company (D-U-N-S) | Kunal |
| The support URL and privacy email | Kunal |
| The review tenant and its demo codes on production | Kunal (the same decision as Play's) |
| A production iOS build, screenshots, and a test on an iPhone through TestFlight | Kunal's EAS account, then us |
