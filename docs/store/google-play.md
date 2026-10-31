# Google Play

Everything the Play Console asks for The Lamp's Android app, ready to paste (decision D100, phase 3 step 10e). Play comes first; the App Store's answers are in [app-store.md](app-store.md). Each answer here must stay true of the app: change it in the same pull request as anything it describes, as the privacy notice (`PRIVACY_NOTICE` in `@thelamp/i18n`) is changed with it.

The app is `com.thelamp.app` (`product.json`); its builds come from EAS on Kunal's Expo account (`eas build --profile production --platform android`, then `eas submit`, which sends them to the internal track as drafts, `apps/mobile/eas.json`).

## Store listing

Default language English (India), `en-IN`, with a Hindi translation, `hi-IN`.

| Field | English | Hindi |
|---|---|---|
| App name (30) | The Lamp | The Lamp |
| Short description (80) | Attendance, visits, orders and expenses for field teams, even offline. | फ़ील्ड टीमों के लिए हाज़िरी, विज़िट, ऑर्डर और खर्च, ऑफ़लाइन भी। |

### Full description, English (4,000)

```text
The Lamp is the work app for field teams that sell and serve across India, in agri inputs, pharma, consumer goods and more. Your organisation sets it up and adds you; you sign in with your mobile number.

In the app:
• Punch in and out, with your route recorded only while you are on duty
• Today's plan, and visits with photos and forms, checked against the place's location
• Orders priced from your organisation's price lists
• Leave, fixes to your attendance, and expense claims with receipts
• Your month's targets and performance
• For managers: your team's day, reviews and approvals on the go

It works offline: what you record is saved on the phone and sent when you are back online.

In English and Hindi.

Location while you are on duty: The Lamp records your location in the background, including with the screen off, from punch-in to punch-out, so your organisation sees attendance, visits and routes. A notification stays visible the whole time, and recording stops when you punch out. Your location is never recorded outside your shifts.

The Lamp is for organisations that use it with their teams: your organisation adds you before you can sign in.
```

### Full description, Hindi

```text
The Lamp भारत भर में बेचने और सेवा देने वाली फ़ील्ड टीमों का काम का ऐप है, कृषि सामग्री, फ़ार्मा, उपभोक्ता सामान और दूसरे क्षेत्रों में। आपका संगठन इसे तैयार करता है और आपको जोड़ता है; आप अपने मोबाइल नंबर से साइन इन करते हैं।

ऐप में:
• पंच-इन और पंच-आउट, और आपका रास्ता केवल ड्यूटी के समय दर्ज होता है
• आज की योजना, और फ़ोटो और फ़ॉर्म के साथ विज़िट, जगह की लोकेशन से जाँची हुई
• आपके संगठन की कीमतों से बने ऑर्डर
• छुट्टी, हाज़िरी में सुधार, और रसीदों के साथ खर्च के दावे
• महीने के लक्ष्य और आपका प्रदर्शन
• मैनेजरों के लिए: टीम का दिन, समीक्षा और मंज़ूरियाँ, चलते-फिरते

यह ऑफ़लाइन भी चलता है: आप जो दर्ज करते हैं, वह फ़ोन पर सहेजा जाता है और इंटरनेट मिलते ही भेजा जाता है।

हिंदी और अंग्रेज़ी में।

ड्यूटी के समय लोकेशन: The Lamp पंच-इन से पंच-आउट तक, स्क्रीन बंद होने पर भी, बैकग्राउंड में आपकी लोकेशन दर्ज करता है, ताकि आपका संगठन हाज़िरी, विज़िट और रास्ते देख सके। इस पूरे समय एक सूचना दिखती रहती है, और पंच-आउट करते ही दर्ज होना बंद हो जाता है। आपकी शिफ़्ट के बाहर आपकी लोकेशन कभी दर्ज नहीं होती।

The Lamp उन संगठनों के लिए है जो इसे अपनी टीमों के साथ इस्तेमाल करते हैं: साइन इन करने से पहले आपका संगठन आपको जोड़ता है।
```

### Graphics

| Asset | File |
|---|---|
| App icon, 512 x 512 | [graphics/play-icon-512.png](graphics/play-icon-512.png) |
| Feature graphic, 1,024 x 500 | [English](graphics/play-feature-graphic-en.png), [Hindi](graphics/play-feature-graphic-hi.png) |
| Phone screenshots, 4 to 8 a language, 9:16, 1,080 x 1,920 | Taken from a production build on an emulator, signed in to the review tenant below, in English and in Hindi |

`node tools/store/graphics.mjs` draws the icon and feature graphics again from the mark, Mukta and the tokens. The screenshots, in this order: Home with today's plan and My month; a visit with its form and photos; the order cart; the punch-in consent sheet; Leave or Expenses; a manager's Team tab.

### Details

| Field | Answer |
|---|---|
| App or game | App |
| Category | Business |
| Contact email | The company's support address, once it exists |
| Website | The company's site, once it exists |
| Privacy policy | `https://<web_domain>/privacy` |
| Account deletion | `https://<web_domain>/delete-account` (Data safety asks for it) |

## App content

| Declaration | Answer |
|---|---|
| Privacy policy | `https://<web_domain>/privacy`; the same notice is in the app at Me › Privacy and on the sign-in screen |
| Ads | No ads. The advertising ID permission is blocked in `app.config.ts`, so the advertising ID declaration is "No" |
| App access | Restricted: see [Review account](#review-account) |
| Content rating | IARC questionnaire, category "Utility, productivity, communication or other": no violence, sexuality, language, controlled substances, gambling, user interaction between strangers or sharing of location with other users outside the organisation; the app shares the user's location with their organisation, so answer "Yes" to sharing location and say it is with the employer only. Expect "Everyone" or "3+" |
| Target audience | 18 and over only; the app is not designed for children |
| News app | No |
| COVID-19 contact tracing or status | No |
| Data safety | See below |
| Government app | No |
| Financial features | None: expense claims are reimbursements an employer records, not a financial service |
| Health | None |
| Location permissions | See [Background location](#background-location) |
| Foreground service | Type `location`, see below |
| Photo and video permissions | None requested: the app takes photos with the camera only, and `READ_MEDIA_IMAGES` and `READ_MEDIA_VIDEO` are blocked. If a form ever lets people choose a photo, it must use Android's photo picker, which needs no permission |

### Review account

The app opens only for people their organisation has added, and signs in with a code sent by SMS, which reviewers can't receive. Reviewers get a review tenant on production: a demo tenant (`pnpm provision --demo`) with fictional people and records, and fixed codes for its numbers in the cell's `DEMO_CODES`. A demo code works only while every tenant of its number is a demo tenant, so it opens nothing real (decision D70). **Proposed, for Kunal to decide:** setting `DEMO_CODES` on the production cell for the review numbers alone.

Instructions for the App access form:

```text
Sign in with mobile number +91 <review field user's number> and code <its demo code>.
For the manager's view, use +91 <review manager's number> and code <its demo code>.
The account is in a demonstration organisation with fictional data. To see location recording, tap Punch in on Home and accept the location request; tap Punch out to stop.
```

## Data safety

The app collects data for the organisation the user works for; the vendor processes it for that organisation (spec 13.4). Service providers acting for us (AWS, the SMS, push and error-report services) don't count as sharing.

| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all collected data encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | Yes: `https://<web_domain>/delete-account` |
| Is data shared with third parties? | No |

| Data type | Collected | Optional | Purposes |
|---|---|---|---|
| Location: precise location | Yes, during shifts, in the background | No for field users | App functionality |
| Location: approximate location | Yes, as part of the precise fix | No for field users | App functionality |
| Personal info: name | Yes, from the organisation | No | App functionality, account management |
| Personal info: email address | Yes, from the organisation where it has one | Yes | App functionality, account management |
| Personal info: user IDs | Yes: employee code and the user's ID | No | App functionality, account management |
| Personal info: phone number | Yes: the sign-in number | No | App functionality, account management |
| Financial info: other financial info | Yes: expense claims' amounts | Yes | App functionality |
| Photos | Yes: photos taken in the app, and a punch-in selfie where the organisation asks | No where a form or the organisation requires them | App functionality |
| App activity: other user-generated content | Yes: visits, forms, orders, leave and requests | No | App functionality |
| App info and performance: crash logs, diagnostics | Yes, once error reporting is switched on, without personal details | No | App functionality |
| Device or other IDs | Yes: a random key the app makes, binding the sign-in to the phone | No | App functionality, fraud prevention and security |

Not collected: messages, contacts, calendar, audio, files and documents, web history, health and fitness, installed apps, other financial info besides claims (the pay estimate, where the organisation uses payroll inputs, is shown from the organisation's records and never sent from the phone, D117), race, religion, political or sexual orientation.

## Background location

| Field | Answer |
|---|---|
| Feature that needs background location | Recording the route of a field person's shift, from punch-in to punch-out, for attendance, visit verification and route review |
| Why it can't be done in the foreground | Field people keep the phone in a pocket with the screen off while travelling between places; the route must be recorded between visits, not only while the app is open |
| Prominent disclosure | The consent sheet at punch-in, before Android's location request: what is recorded, when it starts and stops, and the notification |
| Shown to the user while recording | A notification for the whole shift, from the foreground service |
| Video | About a minute, below, uploaded unlisted to YouTube |

**Video script.** 1. Sign in to the review tenant; Home shows Punch in. 2. Tap Punch in; the consent sheet explains location during the shift; tap Agree. 3. Android asks for location; choose "Allow all the time" in settings, as the app explains. 4. The shift starts and the notification appears; pull down the shade to show it. 5. Lock the phone and walk or drive a short way; unlock: the notification is still there. 6. On a computer, the manager's portal shows the person on the live map and the day's recorded route. 7. Tap Punch out; the notification goes and recording stops.

**Foreground service declaration:** type `location` (`FOREGROUND_SERVICE_LOCATION`), for recording the route during a shift the user started; the same video shows it.

## Release

1. Internal testing: the first production build, to Kunal and the pilot's people, through `eas submit` (internal track, draft; promote it in the console).
2. Closed testing with the pilot organisation, once its accounts exist (phase 1's pilot week).
3. Production, once the closed test passes, the penetration test has no high or critical finding open (spec 15), and counsel has read the privacy notice.

The app targets the API level Expo SDK 57 sets; Play's yearly target requirement is met by taking each SDK release. The version code is kept by EAS (`appVersionSource: remote`, `autoIncrement`).

## Waiting for

| What | Who |
|---|---|
| A Google Play developer account for the company (D-U-N-S number, decision D1) | Kunal |
| The company's support email, website and privacy email (`VITE_PRIVACY_EMAIL`, `EXPO_PUBLIC_PRIVACY_EMAIL`) | Kunal |
| Counsel's reading of the privacy notice, and a native speaker's reading of the Hindi | Kunal |
| The review tenant on production, and whether `DEMO_CODES` may be set there for it | Kunal |
| The production build, screenshots and the location video, once the production cell exists | Kunal's EAS account, then us |
