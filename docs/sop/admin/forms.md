# Build and publish a form

| | |
|---|---|
| **Who** | Admin or Business head (`form.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Forms** |
| **Module** | Core |
| **Related** | [Set the organisation's rules](rules.md), [Set up metrics and the score](metrics-and-score.md), [Set up approval chains](approval-chains.md), [Fill a form](../field/fill-a-form.md), [Review submissions](../manager/review-submissions.md) |

Forms are what people record in the field: a visit report, a stock check, a complaint. The form builder sets who fills a form and where, the proof it needs, and its fields in order, each with an optional condition on earlier fields. Publishing makes a new version; phones take it at their next sync, and submissions already made keep the version they were filled in.

## Before you start

- Account types, roles and designations exist, if the form links to accounts or is for some people only.
- Catalogue items exist, if the form has item lines or choices from the catalogue.
- Decide the form's **Key** and the fields' keys now. A form keeps its key, and a field keeps its key and type once a published version used it, so earlier submissions still read. Metrics refer to forms and fields by these keys.

## Steps

### Start the form

1. Open **Settings** › **Field work** › **Forms**. The table lists each **Form** with its number of **Fields**, its **Version** and its **Status** (**In use** or **Switched off**).
2. Select **Add a form**, or select a form's name to change it.
3. Under **About the form**, fill in:
   - **Key**: lowercase letters, digits and underscores.
   - **Icon**: a Lucide icon name, such as clipboard-list.
   - **Name in English, one** and **Name in English, several** (for example "Visit report" and "Visit reports"), and the same in Hindi.
   - **Reporting tags** (optional): keys, separated by commas.

### Say who fills it, and where

4. Under **Who fills it, and where**:
   - **Link to account** (the tenant's word for account): **No link**, **May link** or **Must link**. With a link, tick **Which types** of account.
   - **Filled during a visit**: tick it for a form filled inside a check-in. It needs **Must link**.
   - **Shift**: **Only on shift**, or **Also off shift**.
   - **Location check**: **As the type sets** (the account type's geofence), **Off**, **Warn when outside** or **Must be inside**.
   - **Review**: **A manager reviews each one**, **Approved by the rules** (automatic approval, if it is switched on) or **No review**.
   - **Roles that can fill it** and **Designations that can fill it**. Choose none for everyone who can submit forms.

### Set the proof it needs

5. Under **Photos and signature**:
   - Tick **Ask for photos of the whole form** to ask for photos of the form as a whole, then set **Fewest photos** (0 makes them optional), **Most photos**, and **Photos from**: **Camera only** or **Camera or gallery**.
   - **Signature**: **None**, **Optional** or **Required**. With **Optional**, select **Require it only when…** to require it only under a condition, such as "**Orders taken in the visit** (the tenant's word for orders) equal to Yes".

### Add the fields

6. Under **Fields**, select a type in **Add a field**:
   - **Short text**, **Long text**: **Fewest characters**, **Most characters**; a short text may have a **Pattern** the whole answer must match.
   - **Number**: **Lowest**, **Highest**, **Decimal places**. **Amount**: **Lowest**, **Highest**, always 2 places.
   - **Date**: **Earliest, in days from today**, **Latest, in days from today**. **Time**.
   - **One choice**, **Several choices**: **Choices from** its own list, **Catalogue products** or **Catalogue items**. For its own list, type **Choices** one per line as `key | English | Hindi`. **Several choices** also takes **Fewest choices** and **Most choices**.
   - **Yes or no**, **Rating**, **Barcode**.
   - **Photo**: **Photos from**.
   - **Account picker**: **Types to pick from**. **Contact picker**: needs the form to link to an account.
   - **Item lines**: **A quantity on each line** (turn off to list items only, such as products talked about; each counts as one), **Most lines**, and an optional **Amount column, in English** and in Hindi (leave empty for quantities only).
   - **Calculated**: see below.
   - **Repeating group**: **Most entries**, then **Fields in each entry**, added with **New field type** and **Add field**. A group can't hold a section, another group or a calculated field.
   - **Section heading** and **Information text** show text only.
7. For each field, fill in its **Key**, **Label in English** and **Label in Hindi**, and if you like **Help in English** and **Help in Hindi**. Tick **Must be filled** if it is required (for a group, **Needs at least one entry**).
8. To show a field only sometimes, select **Show only when…**, choose **Match** (**All of these** or **Any of these**), and add each condition with a **Field**, how it **Is** (equal to, more than, one of, empty, filled and so on) and a **Value**. **Add a condition** adds another; **Remove this condition** takes one out. A condition can only use earlier fields, and in a visit form, **Orders taken in the visit**.
9. Use **Move up**, **Move down** and **Remove** beside a field in the list to order or remove it. A field with a problem is marked **Has problems**.

### Add a calculated field

10. Add a **Calculated** field. In **Formula**, use earlier fields by their keys, numbers, + − × ÷, brackets, round(x, 2), min(…), max(…), if(a > b, then, else) and default(field, 0). Below it the builder says which fields it can use, and reads your formula back as a sentence, so you can check it.
11. Choose what it **Holds**: **A number** or **An amount**, its **Decimal places**, and for a number, **Unit in English** and **Unit in Hindi**.

### Try it, then publish

12. Select **Preview on a phone** to see the form as a phone shows it. Answer there to try the conditions; nothing is kept.
13. Select **Publish** (a new form) or **Publish version 2** (and so on). You see "Version 2 is published."

### Switch a form off or on

14. On **Forms**, select **Switch off** beside a form. It leaves the phones at their next sync; its versions and submissions stay. **Switch on** brings it back.

## What the system checks

- Keys are lowercase letters, digits and underscores, used once in the form. Once a published version used a field, its key and type stay.
- A form filled inside a visit needs a required account link; a contact picker needs the form to link to an account.
- The fewest photos may not be above the most; the fewest choices may not be more than the choices that exist.
- Only an optional signature is required by a condition (`signatureRequired()`).
- Conditions refer only to earlier fields, and only to fields that exist.
- A calculated field reads only earlier number, amount, item lines and calculated fields, never itself. It is worked out exactly, never typed, and is blank while a field it reads is empty. The server works it out again and ignores what the phone sent (`checkFormValues`).
- Patterns are run safely, in linear time.
- Evidence on each submission (photos, place, shift) is judged by the shift and geofence rules (BR-32, BR-33), and anomaly checks may flag it for review (BR-50). See [Set the organisation's rules](rules.md).

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | The form broke a rule. Each problem is listed with where it is, and the field it concerns opens. | Fix each one and publish again. |
| This form could not be found. | The link points to a form that isn't there. | Go back to **Forms**. |
| Check the formula near character 14 | The formula can't be read there. | Fix the formula at that place. |
| Add a number, amount or item lines field before this one to use it here | The calculated field has nothing earlier to use. | Move it below the fields it adds up, or add them first. |
| People don't see a new version | Phones take a new version at their next sync. | Ask them to open the app online. |

## Waiting on the owner

- The Hindi text awaits a native speaker's review, and the server's field-error texts are in English only.
