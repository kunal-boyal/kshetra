# Fill a form

| | |
|---|---|
| **Who** | Field user, Manager (`submission.create`) |
| **Where** | Field app › **More** › **Forms**, or **Home** › **Fill a form**; a visit's forms from the account's screen under **On this visit** |
| **Module** | Core |
| **Related** | [Visit an account](visit-an-account.md), [Use the upload queue](upload-queue.md) |

Forms are what your organisation asks you to record: a visit report, a demo, a survey. Some are filled inside a visit at an account; others on their own. What you fill is kept on the phone as a draft until you submit it, and a submitted form uploads by itself.

## Before you start

- Your admin has published the form for your role. Forms reach the phone with your organisation's configuration.
- A form may need you on duty, checked in at its account, or inside the account's geofence; the form's settings decide.
- Filling, saving and submitting work offline.

## Steps

### Start a form

1. For a visit form: check in at the account ([Visit an account](visit-an-account.md)), then tap the form under **On this visit**.
2. For a form filled on its own: open **More** › **Forms** (or tap **Fill a form** on **Home**) and tap the form under **Start a form**. A form linked to an account type also shows on that account's screen under **To do here**.
3. A draft opens. The bar shows the form's name, its version (**v…**) and **Draft saved on this phone ·** the time.

### Fill the fields

1. Fill the fields in order. Fields appear and disappear as their conditions say, and a required one is marked.
2. Dates and times have **Today** and **Now** buttons; a code field has **Scan**, which opens **Scan a code** and reads the first code it sees, or you type the code.
3. A field for items lets you **Add an item** from the catalogue, with a quantity in its unit (**One less**, **One more**), and **Remove** it.
4. A field that picks an account lists only the accounts of the kinds it allows; a contact field needs the account chosen first.
5. A repeating group adds an entry with **Add to** the group's name; **Remove entry …** takes one out.
6. A calculated field is worked out as you type and can't be changed. It stays blank until every field it reads is filled.
7. A photo field has **Take a photo**, which opens the camera; **Take it again** replaces it.

### Photos and signature

1. Where the form takes photos, **Photos** shows how many you have of the most it takes (**… of …**). Tap **Take a photo**. **Live camera only. Each photo carries its time and place.** There is no gallery.
2. On the camera, tap **Take photo**, then **Use photo** or **Retake**. The first time, tap **Allow the camera**.
3. **Remove photo …** takes a photo off.
4. Where the form asks for a signature, the person signs inside the **Signature** box with a finger. **Clear the signature** starts again.

### Keep, discard or submit

1. Every change is saved on the phone shortly after you make it. To leave and come back later, tap **Close and keep the draft**. Drafts are listed under **Drafts** on **Forms**, with when each was saved.
2. To throw a draft away, tap **Discard this draft**, then **Discard this draft** again on **Discard this draft? What was filled in is lost.** **Cancel** keeps it.
3. To send it, tap **Submit** at the foot. Under it: **No signal? It sends itself when you are back online.**
4. If something needs fixing, the form says **… things need a look before this can be submitted.** and marks each field.
5. Once submitted, the form is read only. A visit form takes you back to the account; another goes back to **Forms**, where it shows under **Waiting to send** (**Kept on this phone until it is sent. It no longer changes.**) and then under **Sent**.

## What the system checks

- Every field is checked on the phone as the server checks it (`checkFormValues`): required fields, lengths, ranges, decimals, dates, patterns, choices and item lines.
- Calculated fields are worked out again on the server; what the phone shows is a preview (decision D118).
- Submitting takes a fresh fix, which must not be mocked and must be accurate to 250 m or better (BR-32).
- A form that needs a shift needs you on duty; a visit form needs you checked in at its account; a form under a required geofence needs you within its radius (BR-32, BR-33).
- Photos must be taken live; a duplicate of an earlier photo is flagged for review, never blocked (BR-40).
- A form filled in a visit can depend on whether an order was taken in that visit; a form submitted in the visit uploads after those orders.
- Submissions never change once sent.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Start your day before submitting this form.** | The form needs a shift | Start your day, then submit |
| **Check in at the account first, then fill this form there.** | A visit form, not checked in there | Check in at the account |
| **You are … m away. This form needs you within … m.** | Outside the geofence the form requires | Go to the account |
| **Fill this in.**, **Enter a number.**, **Take a photo.** and the like | A field's problem | Fix the field shown |
| **This could not be saved on the phone. Try again.** | The phone couldn't save | Try again |
| **This entry is no longer on this phone.** | The draft was discarded or the phone was cleared | Start the form again |
| **The camera is off for this app. Allow it in the phone settings.** | Camera permission was refused for good | Allow the camera in the phone's settings |
| **This was recorded outside your duty hours, so it cannot be saved.** (in the upload queue) | The server found no shift at its time | See [Use the upload queue](upload-queue.md) |

## Waiting on the owner

- The Hindi text of forms, from the templates and from your admin, awaits a native speaker's review.
