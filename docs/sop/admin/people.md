# Add and look after people

| | |
|---|---|
| **Who** | Admin or Business head (`user.manage`) to add, change, transfer and deactivate; Admin, Business head or Manager (`user.reset_device`, `user.sign_out_all`) to reset phones and sign people out |
| **Where** | Web portal › **Team** › **People** |
| **Module** | Core |
| **Related** | [Set up roles and designations](roles-and-designations.md), [Keep extra details about people](people-fields.md), [Build the territory tree](territories.md), [Import records from a spreadsheet](imports.md), [Calendars and holidays](calendars-and-holidays.md), [Check your plan, billing details and invoices](billing.md) |

Everyone who uses the apps is a person here, with a code, a mobile number to sign in with, a designation, a role, a manager and territories. Add them one at a time here, or many at once from a spreadsheet. Then keep them up to date: transfers, phone resets, sign-outs and leavers.

## Before you start

- Roles, designations, people fields and territories are set up ([Set up roles and designations](roles-and-designations.md), [Keep extra details about people](people-fields.md), [Build the territory tree](territories.md)).
- Add managers before the people who report to them.
- For many people, use an import instead ([Import records from a spreadsheet](imports.md)).

## Steps

### Find people

1. Open **People** in the rail, under **Team**. The heading counts people, the active ones and, if your plan has a limit, the seats: for example **12 seats used of 25**.
2. Use **Search** (a name, code or mobile number), **Designation**, **Territory** and the **Active** and **Inactive** chips. The table shows each person's **Designation**, **Territory**, **Reports to**, masked **Mobile**, **Phone** and **Last sync**.

### Add a person

1. Select **Add a person**.
2. Fill **Code** (unique, such as the employee code) and **Name**.
3. **Mobile number**: ten digits, without +91 or 0. They sign in with it.
4. **Email**: needed for single sign-on and for emails such as scheduled reports.
5. **Designation** (required) and **Role**. Leave **Role** at **The designation's own role** to give the designation's default role.
6. **Joining date** and, if known, **Exit date**.
7. **Reports to**: choose their manager, or leave **Nobody: top of the organisation**.
8. Under **Territories**, tick the territories they work in.
9. Fill **More details**, your organisation's own people fields, if shown.
10. Select **Add person**. Their page opens.

They can now sign in: on the phone app with their mobile number and a code, and on the web if their role isn't **Mobile app only**. The first phone they sign in on becomes theirs if your rules bind one phone to a person ([Rules](rules.md)).

### Change their details

1. On their page, select **Edit**.
2. Change what you need and select **Save**. Territories aren't here: use a transfer.
3. If you changed their **Mobile number** or **Email**, a box **Confirm it’s you** appears at the top of the page. Type the code your authenticator app shows in **Authenticator code** and select **Continue**. This keeps a stolen session from moving someone's sign-in elsewhere.

### Transfer them

1. On their page, select **Transfer**.
2. **From**: today, or a later day. Today applies at once; a later day waits for that day.
3. Change any of **Reports to**, **Designation** and **Role**. **Keep as it is** leaves a field unchanged.
4. To move them between territories, tick **Change their territories** and tick their new territories.
5. Select **Transfer**.
6. Their page lists it under **Transfers** as **Scheduled** or **Applied**. Select **Cancel transfer** to cancel one still to come.

### Reset their phone

When someone gets a new phone, or their phone is lost:

1. On their page, under **Phone**, select **Reset phone**.
2. If their phone last reported records not yet uploaded, the box warns you. Ask them to sync first if you can, or those records may be lost.
3. Select **Reset phone** to confirm. They are signed out at once, and the next phone they sign in on becomes theirs.

### Sign them out everywhere

1. On their page, select **Sign out everywhere**, then confirm. They must sign in again on every phone and browser.

### Reset their authenticator

For someone whose role needs an authenticator and who has lost it and their recovery codes:

1. On their page, under **Authenticator**, select **Reset the authenticator**, then confirm.
2. Give a fresh code from your own authenticator when **Confirm it’s you** appears.
3. They are signed out everywhere and set up a new authenticator at their next web sign-in.

### Deactivate a leaver

1. If people report to them, transfer those people to another manager first.
2. On their page, under **Profile**, select **Deactivate**, then **Deactivate** again to confirm. They are signed out everywhere and can't sign in again. Their history stays, and their seat is freed.
3. To bring someone back, select **Reactivate** on their page. If their number now signs in to another organisation, the page says **This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first.**

### Sign everyone out

Use this when sign-ins may be in the wrong hands.

1. On **People**, select **Sign everyone out**. It shows only if your role holds `user.sign_out_all` and reaches **Everyone**.
2. Confirm. Everyone else is signed out of every browser and phone; you stay signed in. The page says how many people were signed out.

### Choose their holiday calendar

On their page, under **Work**, choose a **Holiday calendar**, or leave **The default ({name})**, which names the default calendar. This needs `calendar.manage` ([Calendars and holidays](calendars-and-holidays.md)).

## What the system checks

- A mobile number is ten digits starting with 6, 7, 8 or 9 (`normaliseMobile()`); an email must be a valid address. The form says so before sending.
- Codes and mobile numbers are unique within the organisation.
- A number belongs to one organisation at a time. One active in another organisation is refused, without saying which (`NUMBER_IN_USE`, decision D103).
- Adding or reactivating someone needs a free seat on your plan (`Seats.assertRoom()`, BR-45).
- Nobody gives access they don't hold: you can't give a role with permissions or reach beyond yours (`canGrant()`).
- You can't change your own role or status, reset your own phone, or reset your own authenticator.
- A manager must be active, must not report to the person (no loops), and must hold a designation that can have reports.
- The exit date can't be before the joining date.
- Someone with active reports can't be deactivated or moved to a designation that can't have reports.
- You act only on people your role reaches.
- Every change is in the person's **History** and in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first.** under **Mobile number** | The number is active in another organisation. | Use another number, or ask the person to have their old organisation deactivate them. |
| **Another user has this mobile number** or **Another user has this code** | Someone in your organisation already has it. | Find them with **Search**; use another code or number. |
| Your organisation has used all its seats. Ask an admin to add more. | The plan's seat limit is reached. | Deactivate a leaver, or ask the vendor for more seats ([Check your plan, billing details and invoices](billing.md)). |
| **People still report to this person. Move their reports to another manager first.** | You selected **Deactivate** for someone people report to. | Transfer their reports to another manager, then deactivate them. |
| **This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first.** on their page | You selected **Reactivate**, and their number is active in another organisation now. | Give them another number first, or ask the other organisation to deactivate them. |
| This changed somewhere else. Refresh and try again. | Shown above the form for the clashes above. | Read the field messages. |
| You don't have access to this. | The role you chose goes beyond your own access, or you acted on yourself. | Ask another admin. |
| This is outside the people and places you look after. | The person is outside your role's reach. | Ask someone whose role reaches them. |
| Sign in again with your authenticator to open this organisation. | You cancelled **Confirm it’s you**, or the code was refused. | Make the change again and give a current code. |

The bold messages come from the server, in English.

## Waiting on the owner

- Until MSG91 and DLT registration are in place, the people you add can't receive sign-in codes by SMS in production.
- Problems the server describes come in English only (D42).
