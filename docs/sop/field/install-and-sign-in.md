# Install the app and sign in

| | |
|---|---|
| **Who** | Everyone with a user in the tenant who works on a phone |
| **Where** | Field app › sign-in screen; **More** for language, display and signing out |
| **Module** | Core |
| **Related** | [Start your day](start-your-day.md), [Use the upload queue](upload-queue.md), [Your data and privacy](my-data-and-privacy.md) |

You sign in once on your work phone with your mobile number and a six-digit code sent by SMS. There is no password. The app then stays signed in on that phone.

## Before you start

- Your admin has added you as a user with your mobile number, and your user is active.
- Your number belongs to one organisation only. If the same number is active in another organisation, your admin can't give it to you here (decision D103). The code signs you straight into your organisation; there is nothing to choose.
- An Android phone with the app installed, and signal for signing in. Everything after signing in works offline.

## Steps

### Install the app

1. Install the build your admin or the vendor gives you. The app is not on Google Play yet, so it comes as an installable file (an internal build) until the store listing is approved.
2. Open the app. While it opens it looks for a saved session; the first time there is none, so the sign-in screen shows.

### Sign in

1. To read the app in Hindi, tap the language button at the top right of the sign-in screen (it shows the other language's name, हिन्दी or English). You can change it later under **More**.
2. Under **Mobile number**, type your ten-digit mobile number. The +91 is already there; don't type it, or a leading 0.
3. Tap **Send code**. The app checks the number first and says what is wrong before anything is sent.
4. The screen says **Code sent by SMS to** your number, partly hidden. The code fills itself in when the SMS arrives (**The code fills itself in when the SMS arrives.**). If it doesn't, type the six digits.
5. Tap **Sign in**.
6. If no SMS arrives, wait for the countdown (**You can ask for a new code in … seconds.**) and tap **Send a new code**. To correct the number, tap **Use a different number**.

The screen also says **This phone becomes your work phone. Your manager can move you to a new phone if you change it.** From your first sign-in, your user is bound to this phone; another phone is refused until a manager resets your device. The line at the foot, **Location is recorded only between starting and ending your day.**, is the promise the app keeps: tracking runs only while you are on duty. **Privacy** opens the privacy notice before you sign in.

### Choose the language and the display

1. Open **More**.
2. Under **This phone**, set **Language** to English or हिन्दी. Screens, notifications and your organisation's own words (such as Beat or Liquidation) follow it.
3. Set **Display** to **Same as phone**, **Light**, **Dark** or **Outdoor**. **Outdoor is high contrast, for work in bright sun.**

### Sign out

1. Open **More** and tap **Sign out** at the foot.
2. If you are on duty or some records haven't uploaded, the app warns you first:
   - **You are on duty. Signing out stops recording your route; the day stays open until you sign in again and end it.**
   - **… records haven't uploaded. They stay on this phone and upload when you sign in again.**
3. Tap **Stay signed in** to go back, or **Sign out anyway**. Records that haven't uploaded stay on the phone and upload when you sign in again on it. The accounts, prices and other copies the phone kept are cleared and come back with the next sync.

## What the system checks

- A mobile number is ten digits and starts with 6, 7, 8 or 9; a landline is refused (`normaliseMobile()`).
- A code is six digits, lasts five minutes and allows five tries. You can ask for three codes in ten minutes.
- The server answers the same way for a number it doesn't know, so a wrong number just never gets an SMS. Check the number with your admin if no code ever arrives.
- With device binding on (the default), a phone must be the one your user is bound to, or becomes it when you have none (BR-38). A manager resets it (`user.reset_device`).
- Your user and your organisation must be active. While your organisation is read only or suspended, what you record waits on the phone and uploads once it is active again; while it is read only, **Home** says so.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Enter all 10 digits of the mobile number** or **A mobile number starts with 6, 7, 8 or 9** | The number typed isn't a mobile number | Type the ten digits without +91 or 0 |
| **That code is not right. Check it and try again.** | Wrong code, or the number isn't registered | Check the SMS; if it keeps failing, ask your admin whether the number on your user is right |
| **This code has expired. Ask for a new one.** | More than five minutes passed | Tap **Send a new code** |
| **Too many attempts. Wait a moment, then try again.** | Too many codes or tries in a short time | Wait ten minutes |
| **This phone is not registered for your account. Ask your manager to reset your device.** | Your user is bound to another phone | Ask your manager to reset your device, then sign in again |
| **The server could not be reached. Check your connection, then try again.** | No signal, or the server is down | Move to signal and try again |
| **Update the app** with **Open the store** | This version is too old for the server | Tap **Open the store** and update the app there |
| **Update the app** with **Ask your admin how to get the new version of the app.** | This version is too old, and this build names no store page | Ask your admin for the newer build and install it |
| **You have been signed out. Sign in again.** | Your session was ended, for example by an admin | Sign in again; unsent records are still on the phone |

## Waiting on the owner

- The app isn't on Google Play yet: the listing needs the new company registered, its D-U-N-S number and the Play Console. Until a build carries the store page's address, the update screen shows no **Open the store** and tells people to ask their admin.
- SMS codes in production need MSG91 with DLT registration and an approved template.
- The Hindi text awaits a native speaker's review.
- The Outdoor display hasn't had its field test in midday sun on two Android brands.
