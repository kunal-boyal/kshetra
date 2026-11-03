# Fix photo problems

| | |
|---|---|
| **Who** | The field person; reviewers and approvers (`submission.review`); the tenant's admin (`settings.manage`) |
| **Where** | Field app › **Camera**, **More** › **Upload queue**; web portal › **Review**, a claim or collection, **Settings** › **Rules** › **Keeping records** |
| **Module** | Core |
| **Related** | [Fill a form](../field/fill-a-form.md), [Upload queue and sync](upload-queue-and-sync.md), [GPS and geofences](gps-and-geofences.md) |

Photos of work, selfies, receipts, odometers and cheques are taken with the app's own camera, saved on the phone, and uploaded straight to storage on their own. The record they belong to waits on the phone until its photos have gone. The server then checks each photo, makes a thumbnail and a stamped copy, and looks for repeats.

## What you see, and what to do

### The camera won't open

| What you see | What it means | What to do |
|---|---|---|
| **Allow the camera to take photos of your work. Photos are taken live, never from the gallery.** with **Allow the camera** | The app hasn't been allowed the camera yet | Tap **Allow the camera** and allow it when the phone asks. |
| **The camera is off for this app. Allow it in the phone settings.** with **Open app settings** | The camera was refused, and the phone won't ask again | Tap **Open app settings**, allow the camera under the app's permissions, then come back, tap **Back** and open the camera again. |
| **The photo could not be taken. Try again.** | The camera failed to take the shot | Tap **Take photo** again. Restart the app if it keeps failing. |
| **The photo could not be saved on the phone. Try again.** | The phone couldn't keep the file | Free some space on the phone, then take it again. |

### Photos wait to upload

After **Use photo**, the form says **Photo taken. It uploads by itself.** Each photo is its own **Photo** item in the upload queue, and the record that holds it waits behind it.

| What you see | What it means | What to do |
|---|---|---|
| **Photo** items **Waiting** in the queue, with **Next try** | No signal, or storage didn't answer | Nothing. They upload when there is signal; tap **Sync now** to try at once. Photos are the largest uploads, so they take longest on a weak signal. |
| A record **Waiting**, with **A photo is still uploading. This will retry by itself.** | The server hasn't got the photo yet | Nothing. It goes once its photo has. |
| A **Photo** item **Refused** with **The server refused some of its details.** and the server's words below it | Storage refused the file's bytes, or the server refused the photo | Discard the photo and the record that needed it (it is refused with **Something this record needed was discarded, so it can't upload. Discard it too.**), then record it again with a new photo. |
| A record **Refused** with **The server refused some of its details.** and a line for each photo the server refused | One of its photos failed the checks below | Discard it and record it again, taking the photos at the time and place. |

What the server refuses in a record's photos (BR-32, `photoIssues()`): a photo taken by someone else; one that already belongs to another record; one from the gallery where the form takes the camera only; one taken more than 5 minutes from the record; one taken more than 500 m from it.

### A reviewer sees an empty photo tile

A photo shows on **Review**, a claim or a collection only once the server has checked it.

| Why | What to do |
|---|---|
| It is still uploading from the phone, or still being processed | Wait and open the record again later. Check the person's **Waiting to upload** on their page under **People**. |
| The server couldn't use it (not a real JPEG, or it wouldn't decode); it is shown to nobody | Ask the person to record it again if the photo matters. |
| Its keeping time has ended and it was removed (see below) | Nothing can bring it back. |
| The page was left open a long time | Links to photos last 5 minutes. Reload the page. |

### "Repeated photo" and "Receipt seen before"

A photo the same as an earlier one is flagged, never refused (BR-40):

- the same bytes as any other photo in the organisation, at any time, or
- nearly the same picture as another photo of the same kind taken in the 90 days before, by its difference hash (four bits or fewer apart).

A form shows **Repeated photo** among its flags and **Repeats another photo** under the photo. An expense claim shows **Receipt seen before**. The reviewer decides: a photo of the same shelf on another day can look alike; the same photo sent twice for two visits, or one receipt claimed twice, is the case the flag is for. Reject with a reason the person will read.

### "Photo from the gallery"

A form whose **Photos from** is **Camera or gallery** lets people attach a photo from the phone's gallery. Such a photo is flagged **Photo from the gallery** and carries **Chosen from the gallery. The time and place shown are when it was attached.** The time and place are the attaching's, not the photo's. Where photos must be live, set the form's **Photos from** to **Camera only**.

A photo taken far from where its form was filled is flagged **Photo taken far away** ([GPS and geofences](gps-and-geofences.md)).

### Old photos are gone

Evidence photos, signatures and the other photos are kept for **Keep photos for** (**Settings** › **Rules** › **Keeping records**; 12 months by default, from 3 to 60). Each photo keeps the time that was set when it was taken, so changing the setting affects only photos taken afterwards. Once a photo's time has passed, a nightly job deletes the file with its thumbnail and stamped copy, and records the run in **Settings** › **Audit log** with the action `retention.applied`. The record itself stays; its photo tile is then empty. **Settings** › **Security and data** shows the keeping time under **Evidence photos**.

If an inspection or a dispute needs photos for longer, raise **Keep photos for** before they are taken.

## What the system checks

- A photo is uploaded as a JPEG of at most 10 MB whose checksum storage checks, then decoded in full by the server; a file that fails is never shown (spec 12.2).
- A record's photos are the person's own, held by no other record, from the camera unless the form allows the gallery, within 5 minutes and 500 m of the record (BR-32).
- Repeats are flagged by the same bytes, or a near-identical picture of the same kind within 90 days (BR-40).
- Photos expire by the keeping time they were captured under (BR-41, decision D69).

## Waiting on the owner

- The app isn't on Google Play yet, and the device protocol (spec 14.5) has yet to run on two Android brands, so the camera hasn't been tried across phone makers.
- The server's own words about a refused photo are English and aren't shown on the phone, which shows the general sentence for its code (D42 open item).
