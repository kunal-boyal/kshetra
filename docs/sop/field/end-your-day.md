# End your day

| | |
|---|---|
| **Who** | Field user, Manager (`shift.use`) |
| **Where** | Field app › **Home** › the shift card › **End day** (**Punch out** in the agri template) |
| **Module** | Core |
| **Related** | [Start your day](start-your-day.md), [Use the upload queue](upload-queue.md), [Claim an expense](claim-expenses.md) |

Ending the day closes your shift and stops the route recording. Do it where your work ends. Like the start, it is saved on the phone first and uploads when there is signal.

## Before you start

- You are on duty: the shift card says **On duty since** a time.
- Location is on. Ending the day takes a fresh fix.
- If your organisation asks for the odometer, have the vehicle in front of you.

## Steps

### Without an odometer reading

1. On **Home**, tap **End day** on the shift card (whether it says **Tracking**, **Paused** or **Not recording**).
2. If records are still on the phone, it asks **Some records are still on this phone. They upload when there is signal. End the day now?** Tap **End day**, or **Cancel**. Ending the day doesn't lose them; they upload when there is signal.
3. The card goes back to **Off duty**.

### With an odometer reading

1. Tap **End day** on the shift card. **End your day** opens.
2. The **Odometer** card shows **Opening reading: … km** from the start of the day.
3. Type the closing reading under **Odometer reading (km)** and tap **Photograph the odometer**.
4. Tap **End day**. Where the odometer is optional, **Skip** ends the day without it.
5. The app goes back to **Home**, **Off duty**.

### What happens next

- Recording stops, and the notification **On duty** goes.
- If you were checked in at an account, the visit is checked out with the day.
- The end of the day and the route points still on the phone upload when there is signal. Points upload only after the day's start has reached the server.
- On the server, your route becomes a trail your managers can replay, and your attendance day is worked out from the shift. A per-km claim from tracked distance can use the day's distance once every shift of that day has ended and uploaded ([Claim an expense](claim-expenses.md)).
- If you forget to end the day, the phone stops recording once the shift passes the longest allowed length (14 hours by default), and the nightly job closes a shift left open past that length.

## What the system checks

- The fix that ends the day must not be mocked and must be accurate to 250 m or better (BR-36, `punchFixIssue()`).
- The closing odometer reading can't be below the opening one; where the odometer is required, the reading and its photo are both needed (`odometerIssue()`). The kilometres between them are shown beside the tracked distance, never in its place (decision D99).
- Only points recorded inside your shift count (BR-36).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Allow location to start or end the day.** | Location is off | Allow location for the app |
| **Your location could not be found. Step outside and try again.** | No fix yet | Step into the open and try again |
| **Your location is not accurate enough yet. Step outside and try again.** | The fix is worse than 250 m | Wait in the open for a better fix |
| **This location is mocked. Turn off any app that fakes it.** | A location-faking app is on | Turn it off |
| **This is below the opening reading, … km.** | The closing reading is lower than the opening one | Check the odometer and type it again |
| **Enter the reading.** / **Take a photo of the odometer too.** | The odometer step is incomplete | Type the reading and take the photo |
| **This could not be saved on the phone. Try again.** | The phone couldn't save | Try again |

## Waiting on the owner

- Background location needs a development or production build, and the device protocol on two Android brands is still to run.
