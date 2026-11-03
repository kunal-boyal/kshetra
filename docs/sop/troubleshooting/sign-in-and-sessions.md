# Sort out a sign-in or session problem

| | |
|---|---|
| **Who** | The person who can't sign in; their manager or the tenant's admin (`user.reset_device`, `user.sign_out_all`, `user.manage`); vendor support (`platform.support.request`) |
| **Where** | Field app › sign-in screen; web portal › sign-in page, **People** › the person, **Your profile and settings** › **Sign-in security**; platform console › **Tenants** › the tenant |
| **Module** | Core; **Single sign-on** for the SSO parts |
| **Related** | [Install the app and sign in](../field/install-and-sign-in.md), [Use the upload queue](../field/upload-queue.md), [Reset a tenant user's authenticator](../vendor/tenant-second-factor.md), [Access and modules](access-and-modules.md) |

Everyone signs in with their mobile number and a six-digit code sent by SMS; there is no password. On the web, people whose role can change access also give a code from an authenticator app, and a tenant on the **Single sign-on** module can send its people to its own identity provider instead. Start from what the person sees, then follow the fix.

## Before you start

- Ask the person exactly what the screen says, and whether it is the phone or the web. The texts below are the English ones; a Hindi reader sees the same message in Hindi.
- Have the person's page open in the portal: **People** › the person. It shows their **Mobile number**, their **Phone** (model, **Last seen**, **Waiting to upload**) and, for those who need one, their **Authenticator**.
- A person belongs to one organisation. A number active in one tenant can't sign in to another (decision D103).

## What you see, and what to do

### The code never arrives

| Why | How to tell | What to do |
|---|---|---|
| The number isn't the one the organisation has for them, or nobody active has it | Their page shows a different **Mobile number**, or they are **Inactive**, or they aren't found under **People** | The server answers the same way for a number it doesn't know and sends nothing, so the screen still says **Code sent by SMS to** the number. Correct the number on their page, or make them active again (**Reactivate**). |
| The organisation is suspended | The tenant's status in the console; admins see it on **Settings** › **Billing** | No code is sent to anyone in a suspended organisation. See [Access and modules](access-and-modules.md). |
| They asked too often | The screen says **Too many attempts. Wait a moment, then try again.** | Three codes a number in ten minutes, and twenty from one address an hour. Wait ten minutes, then tap **Send a new code** once. |
| The SMS is slow or the provider is down | Codes stop reaching many people at once | Wait for the countdown (**You can ask for a new code in … seconds.**), then **Send a new code**. If many people are affected, vendor support follows [docs/runbooks/otp-provider-outage.md](../../runbooks/otp-provider-outage.md). People already signed in carry on: a phone's session lasts 30 days unused. |
| A local or demo install | The API runs with `OTP_PROVIDER=console` or on a demo cell | Locally the code prints in the API's console, with the number masked. A demo cell sends no SMS; demo numbers use fixed codes the vendor keeps. |

### The code is refused

| What you see | What it means | What to do |
|---|---|---|
| **That code is not right. Check it and try again.** | A wrong code, or a code for a number the system doesn't know | Check the digits. A code is six digits. If it is right and still refused, check the number as above. |
| **This code has expired. Ask for a new one.** | The code is older than five minutes, it was already used, or five wrong tries spent it | Tap **Send a new code**. |
| **Too many attempts. Wait a moment, then try again.** | Ten wrong codes for the number in an hour, or twenty in a day, or thirty tries from one address in an hour | Wait an hour. Every wrong try counts, so don't guess. |
| **Enter a 10-digit mobile number, such as 98765 43210.** | The number isn't a mobile number | Ten digits starting with 6, 7, 8 or 9, without +91 or 0. |

### "This mobile number is already in use"

An admin adding a person or changing their number sees, under **Mobile number**: "This mobile number is already in use. Use another number, or ask the person to be removed from their current organisation first." In an import of people the same sentence shows against the row. **Reactivate** on the person's page refuses for the same reason, with the same sentence.

- Why: the number is active in another organisation. A person belongs to one at a time, and the message never says which (decision D103).
- What to do: ask the person. If they have left the other organisation, its admin must deactivate them there first; once they are inactive there, this organisation can add the number. Otherwise use another number.

### A new phone, or "This phone is not registered for your account"

The person sees **This phone is not registered for your account. Ask your manager to reset your device.** With device binding on (the default, **Settings** › **Rules** › **One phone per person, until a manager resets it**), each person signs in on one phone until someone resets it (BR-38).

Reset the phone:

1. If the person still has the old phone, ask them to open **More** › **Upload queue** on it and tap **Sync now** until it says **Everything has uploaded**. What hasn't uploaded stays on the old phone.
2. In the portal, open **People** and the person.
3. Under **Phone**, check **Waiting to upload**. It shows what the old phone last reported, such as "2 waiting, 0 refused".
4. Tap **Reset phone**. The question reads "Reset … 's phone? They are signed out at once, and the next phone they sign in on becomes theirs." If the old phone last reported records not yet uploaded, it also warns: "Their phone last reported … records not yet uploaded. Ask them to sync first, or they may be lost."
5. Tap **Reset phone** again to confirm. The page says **The phone is reset.**
6. The person signs in on the new phone. Whichever phone signs in first becomes theirs, so the old phone must not sign in again.

For a lost or stolen phone, reset it as above, then tap **Sign out everywhere** on the same page and confirm. It says **They are signed out everywhere.** The old phone can no longer reach the person's data, but it stays registered for push, so notifications meant for the person may still show on it.

Who may do it: Admin, Business head and Manager (`user.reset_device`), only for people within their scope. Nobody resets their own phone: "You cannot reset your own device. Ask your manager or an admin to do it." shows as **You don't have access to this.** By practice ([docs/runbooks/device-reset.md](../../runbooks/device-reset.md)) vendor support asks the tenant's admin rather than resetting a phone under a support grant.

### "Use the mobile app for this" on the web

A role restricted to the phone (Field user, by default in every template) can't sign in to the portal: the web answers **Use the mobile app for this.** If the person should use the portal, an admin gives them a role that isn't phone-only.

### The authenticator step

On the web, after the SMS code, anyone whose role can change access (`role.manage`, `user.manage`, `settings.manage`, `module.manage`, `billing.manage` or `erp.manage`) sees **Enter your authenticator code**; the first time, **Set up your authenticator** with a QR code, then **Save your recovery codes**. Admin and Business head hold these permissions by default. Phones never ask for it, and demo tenants skip it.

| What you see | What to do |
|---|---|
| **That code is not right. Check it and try again.** | Check that the phone holding the authenticator sets its clock automatically; authenticator codes depend on it. Enter the six digits the app shows now, not one already used. |
| They lost the phone with the authenticator | On the same screen, tap **Use a recovery code instead** and enter one of the codes they saved, such as K7Q2M-XW4PA. Each code works once. |
| **This code has expired. Ask for a new one.** after several tries | Five wrong tries, or more than five minutes on this step, end it. Start again from the mobile number. |
| **Too many attempts. Wait a moment, then try again.** at **Sign-in security** or a step-up | Five tries in a few minutes. Wait about ten minutes. |
| No authenticator and no recovery codes | Another admin resets it, as below. If no other admin can, vendor support does. |

Reset someone's authenticator, as an admin (`user.manage`):

1. Open **People** and the person. Under **Authenticator** it says **Set up**, **Not set up yet: they set it up at their next web sign-in.** or **Not needed for this role.**
2. Tap **Reset the authenticator**. The question reads "Reset …'s authenticator? They are signed out everywhere and set up a new one at their next web sign-in."
3. Confirm. The portal asks **Confirm it’s you**: enter the code from your own authenticator and tap **Continue** (a step-up, below).
4. The page says **Reset. They set up a new authenticator at their next sign-in.**

Nobody resets their own: they use a recovery code, or ask another admin.

When the only admin has lost both, vendor support resets it from the console: **Tenants** › the tenant › **Reset an authenticator**. Fill **Their mobile number** and **How you confirmed it is them**, then **Reset**. The console says **Removed. They set up a new authenticator at their next sign-in.**, or **They had no authenticator; their sessions have ended.** Confirm who is calling before you do it. See [Reset a tenant user's authenticator](../vendor/tenant-second-factor.md).

### "Confirm it’s you" (step-up)

Changing who signs in as whom asks for a fresh authenticator code, good for ten minutes: changing a person's mobile number or email, resetting someone's authenticator, and saving **Single sign-on**. The portal shows **Confirm it’s you** with "This change decides who can sign in as whom. Enter the code your authenticator app shows now." Enter the code and tap **Continue**; the change then goes ahead. **Cancel** leaves it undone.

- A wrong code is asked for again, three times at most.
- Vendor support can't make these changes under a support grant; the tenant's admin makes them.
- Someone with no authenticator set up can't step up. Instead of asking for a code, **Confirm it’s you** says **This change needs a code from an authenticator app, and you have none set up. Set one up at Sign-in security first, then make the change again.**, with **Set up an authenticator**, which opens **Sign-in security**, and **Cancel**. Either leaves the change undone. This happens to an admin of a demo tenant, or one who signs in only through single sign-on. Once their authenticator is set up, they make the change again.
- **Cancel** shows **Sign in again with your authenticator to open this organisation.** The change simply wasn't made; there is no need to sign in again.

### Single sign-on

On the web, a tenant with **Single sign-on** on lets people in its email domains choose **Company SSO**, enter their **Work email** and **Continue** to their organisation's sign-in page. Phones keep signing in with a code.

| What you see | What it means | What to do |
|---|---|---|
| **Your organisation signs you in with its own sign-in. Enter your work email to continue.** after the SMS code | The organisation requires SSO for this person's email domain (**Required** on **Settings** › **Single sign-on**) | The page switches to the SSO step. Enter the work email and **Continue**. |
| **Your organisation doesn’t use single sign-on for this email. Sign in with your mobile number.** | No SSO connection covers that email's domain | Use **Mobile number**, or ask the admin to add and prove the domain. |
| **The sign-in took too long. Try again.** | The provider's answer came back too late, or in a different browser from the one that started | Start again, and finish in the same browser. |
| **Your organisation’s sign-in didn’t complete. Try again, or ask your administrator.** | The identity provider refused, or its answer didn't check out | The admin checks the connection's settings with the provider. |
| **That email isn’t one your organisation signs in with SSO.** | The provider vouched for an email outside the connection's domains | The admin adds and proves the domain, or the person uses their work address. |
| **Nobody here has that work email. Ask your administrator to add it to your profile.** | Nobody in the organisation has that email on their profile; SSO never creates people | An admin puts the email on the person's page. |
| **Single sign-on isn’t available for your organisation right now. Sign in with your mobile number.** | The connection is off, or the **Single sign-on** module is off by the admin or the plan | Use the mobile number. While the module is off, nobody is refused the code for SSO. |

After SSO, the portal asks for our authenticator code too unless the identity provider says it asked for a second factor itself.

### Signed out unexpectedly

The person sees **You have been signed out. Sign in again.** and the sign-in screen.

| Why | What to do |
|---|---|
| The session reached its limit: on the web 12 hours unused or 7 days after signing in; after single sign-on, 12 hours; on a phone 30 days unused or 90 days after signing in (`sessionExpiresAt()`) | Sign in again. On a phone, records not yet uploaded stay on it and upload once the same person signs in again. |
| Someone changed their **Mobile number**, role or status, reset their phone or authenticator, or used **Sign out everywhere** | Expected. Sign in again. |
| An admin used **Sign everyone out** on **People** (it asks "Sign everyone else out of every browser and phone? …") | Everyone but that admin signs in again. |
| They ended the session themselves at **Sign-in security** › **Where you’re signed in** (**End**, or **Sign out everywhere else**) | Sign in again. |
| The same session's token came back after it was used, which only a copy of it does | The session ends for safety. Sign in again; if it happens again on one phone, reset the phone. |

People can see where they are signed in at **Your profile and settings** › **Sign-in security** › **Where you’re signed in**, and end any they don't recognise.

### "Update the app to continue"

The phone shows **Update the app** with **This version of the app is no longer supported. Update it to keep working.** Nothing else opens until the app is updated. On Android, **Open the store** opens the app's store page. Records saved on the phone stay there and upload after the update. The web is never turned away.

## What the system checks

- A mobile number is ten digits starting with 6 to 9 (`normaliseMobile()`); a code is sent only to an active person in an active organisation, and the answer is the same either way (M1).
- Codes last five minutes and allow five tries; three codes a number in ten minutes; twenty requests an hour from one address; thirty checks an hour from one address; ten wrong codes a number an hour and twenty a day (M1, rule 3).
- With device binding on, a person signs in on one phone until it is reset (BR-38). Every request checks the person, organisation and phone are still active (BR-39).
- Session limits are `sessionExpiresAt()`: web 12 hours unused and 7 days, single sign-on 12 hours, phones 30 days unused and 90 days.
- The authenticator is asked for on the web for roles that can change access; changes to who signs in as whom need a code from the last ten minutes.

## Waiting on the owner

- SMS codes in production need MSG91 with DLT registration of the entity, the sender ID and the one-time-code template. Until then nobody can sign in by SMS on a production cell.
- A second SMS provider behind the code sender, for outages, is planned but not built; until then the fallback is waiting.
- The app isn't on Google Play yet, so **Open the store** has no listing to open; updates come as an installable file.
- Texts the server writes, such as the "already in use" sentence beside a field or a conflict's reason on a person's page, are English even for Hindi readers (D42 open item).
