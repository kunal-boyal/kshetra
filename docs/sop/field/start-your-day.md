# Start your day

| | |
|---|---|
| **Who** | Field user, Manager (`shift.use`; pausing needs `tracking.pause`) |
| **Where** | Field app › **Home** › the shift card › **Start day** (**Punch in** in the agri template) |
| **Module** | Core |
| **Related** | [End your day](end-your-day.md), [Follow today's plan](todays-plan.md), [Use the upload queue](upload-queue.md) |

Starting the day opens your shift: from then until you end the day, the phone records your route in the background. Check-ins, forms that need a shift, and expense distances all hang on it. Start it where your work begins.

## Before you start

- You are signed in on your work phone ([Install the app and sign in](install-and-sign-in.md)).
- Location is on for the app. For a recorded route, the app needs location all the time; it asks for it during these steps.
- Your admin decides whether the day needs a selfie (the attendance selfie setting) and whether it needs the vehicle's odometer (off, optional or required). Both are off by default.
- No signal is needed. The start is saved on the phone and uploads when there is signal.

## Steps

### Start the day

1. On **Home**, the shift card says **Off duty**. Tap **Start day**.
2. Read **Before you start the day**. It says how often your location is recorded (about every minute by default), that it is recorded with the screen off, that a notification stays while it records, that your managers can see your route and where you were, and that recording stops when you end the day or pause it.
3. Tap **I agree, find my location**. Stand in the open: the app waits for a fresh fix of 250 m or better.
4. If your organisation asks for a selfie, the screen says **Your organisation asks for a selfie to start the day.** Tap **Take a selfie**. The front camera opens; tap **Take photo**, then **Use photo**, or **Retake**.
5. If your organisation asks for the odometer, the **Odometer** card shows.
   1. Type the reading under **Odometer reading (km)**, such as 12045 or 12045.5.
   2. Tap **Photograph the odometer** and take a live photo of it. Once taken, it says **Photo taken**; **Take it again** replaces it.
   3. Tap **Continue**. Where the odometer is optional, **Skip** goes on without it.
6. Read **Allow location all the time**, then tap **Start day**. On the phone's own question that follows, choose "Allow all the time".
7. The app goes back to **Home**. The card says **On duty since** the time, with the badge **Tracking**, your time on duty, the distance travelled (about) and today's visits. A notification **On duty** stays on the phone while it records.

If you don't allow location all the time, the day still starts, but the app opens **Keep your route recorded** instead of Home, and the card shows **Not recording**.

### Pause and resume tracking

Only roles that may pause tracking (`tracking.pause`) see **Pause tracking** and **Resume tracking**; others end the day instead.

1. On the shift card, tap **Pause tracking**.
2. Under **Why are you pausing?**, choose **A break**, **Personal time**, **No GPS where I am** or **Something else**. **Cancel** closes it without pausing.
3. The card shows **Paused**. Location stops being recorded; you stay on duty for attendance.
4. Tap **Resume tracking** to start recording again.

### When the card says Not recording

Recording can stop by itself: the phone restarted, the app was force-stopped, a battery saver closed it, or location permission was taken away. The card then shows **Not recording**.

1. Tap **Record again**. If the app can't start recording, it opens **Keep your route recorded**.
2. Or tap **Fix this** to open **Keep your route recorded** directly.
3. Under **On this phone**, check **Location all the time** (**Allowed** or **Not allowed**) and **Battery use for this app** (**Restricted** or **Unrestricted**).
4. Follow the three steps for your phone's maker (Xiaomi, Redmi and POCO, Vivo, Oppo, Realme, OnePlus, Samsung, or any other phone). For example, on Samsung: set Location to "Allow all the time", choose "Unrestricted" under Battery, and keep the app out of Sleeping or Deep sleeping apps. **Other phones** lists the other makers' steps.
5. Tap **Open app settings** to make the changes, then come back and tap **Record again**.

## What the system checks

- The fix that starts the day must not be mocked and must be accurate to 250 m or better (BR-36, `punchFixIssue()`).
- An odometer reading is a number of kilometres to one decimal place. Where the odometer is required, the reading and its photo are both needed (`odometerIssue()`).
- Tracking starts only from **Start day**, **Resume tracking** or **Record again**; it never starts by itself (BR-37).
- Each recorded point counts only if it isn't mocked, is within 250 m accuracy and falls inside your own shift (BR-36). The phone drops points the server would refuse.
- The phone stops recording once a shift passes the longest allowed length (14 hours by default), and the nightly job closes a shift left open past it.
- If the phone's clock is more than ten minutes off the server's, what it records is flagged (BR-44).
- Your points upload only after your start has reached the server.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Allow location to start or end the day.** | Location is off for the app | Allow location in the phone's settings, then try again |
| **Your location could not be found. Step outside and try again.** | No fix yet | Step into the open and tap **I agree, find my location** again |
| **Your location is not accurate enough yet. Step outside and try again.** | The fix is worse than 250 m | Wait in the open for a better fix |
| **This location is mocked. Turn off any app that fakes it.** | A location-faking app is on | Turn it off; the app reports mocked fixes to your organisation |
| **Enter the reading.**, **Take a photo of the odometer too.** or **Write a reading such as 12045 or 12045.5.** | The odometer step is incomplete | Type the reading and take the photo |
| **This could not be saved on the phone. Try again.** | The phone couldn't save the start | Try again; if it repeats, restart the app |
| **Your day has already started.** (in the upload queue) | A start was already recorded | Nothing to do; discard the refused start |

## Waiting on the owner

- Background location needs a development or production build; it doesn't run in Expo Go.
- The device protocol (spec 14.5) still has to be run on two Android phones of different brands, so the maker-by-maker battery steps haven't been checked on real phones.
- The Hindi text awaits a native speaker's review.
