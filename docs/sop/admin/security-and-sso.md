# Set up sign-in security and single sign-on

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`); the audit log on the same page needs `audit.view` |
| **Where** | Web portal › **Settings** › **People and access** › **Security and data**, and › **Single sign-on** |
| **Module** | Core; single sign-on needs the **Single sign-on** module |
| **Related** | [Sign in to the portal for the first time](first-sign-in.md), [Add and look after people](people.md), [Set up roles and designations](roles-and-designations.md), [Rules](rules.md), [Read the audit log](audit-log.md), [Approve or end vendor support access](vendor-support.md) |

**Security and data** shows at a glance how people sign in, how long records are kept and who can reach your data, each with a way to the page that changes it. **Single sign-on** lets people sign in to the portal with your own identity provider, through OIDC or SAML, instead of a code by SMS.

## Before you start

- For single sign-on: the **Single sign-on** module is on ([Switch modules on and off](modules.md)), and you have access to your identity provider's admin console and to your email domain's DNS.
- Each person who will use single sign-on has their work email on their profile ([Add and look after people](people.md)). Nobody is added automatically.

## How sign-in works today

- Everyone signs in with their mobile number and a one-time code by SMS.
- On the web, anyone whose role holds `role.manage`, `user.manage`, `settings.manage`, `module.manage`, `billing.manage` or `erp.manage` also gives a code from an authenticator app. Anyone else may turn one on at **Sign-in security** in their profile menu. Phones never ask for it.
- A web session ends after 12 hours without use and after 7 days at most. A single sign-on session lasts 12 hours. Phones stay signed in for 30 days without use and 90 days at most.
- Whether each person may use one phone only is a rule ([Rules](rules.md)).
- Changes that decide who signs in as whom ask for a fresh authenticator code, a step-up: changing a person's mobile number or email, resetting someone's authenticator, and saving single sign-on. A box **Confirm it’s you** appears at the top of the page; type the code in **Authenticator code** and select **Continue**. A code counts for ten minutes.

## Steps

### Check the overview

1. Open **Settings** › **People and access** › **Security and data**.
2. **Sign-in** shows **Single sign-on** (**Connected, required**, **Connected** or **Not set up**), **Authenticator for admins** (**Asked on the web**), **Web sessions end** and **Phones per person**. **Change** opens the page that changes them.
3. **How long we keep things** shows **Every location point**, **Daily routes**, **Evidence photos** and **Audit log**. **Change** opens **Rules**.
4. **Your data** offers **Export** ([Export all your organisation's data](data-export.md)) and shows whether **Vendor support** is **Open now** or **Off**, with a way to **Vendor support** ([Approve or end vendor support access](vendor-support.md)).
5. Below the cards is the audit log ([Read the audit log](audit-log.md)).

### Register the product with your identity provider

1. Open **Settings** › **People and access** › **Single sign-on**.
2. Under **For your identity provider**, copy the values your provider needs: **Redirect URI (OIDC)**, or for SAML the **Entity ID (SAML)**, **Assertion consumer URL (SAML)** and **Metadata (SAML)**.
3. In your provider's console, register the product as an application with those values.

### Connect

4. Under **Connection**, choose the **Protocol**: OIDC or SAML.
5. For OIDC, fill **Issuer URL** (where the provider's `.well-known/openid-configuration` is), **Client ID** and **Client secret**.
6. For SAML, fill **Sign-in URL**, **Provider’s entity ID** and **Signing certificate** (the provider's certificate, as PEM).
7. In **Email domains**, put each domain on its own line.
8. Tick **On** so people in these domains can choose to sign in with single sign-on. Leave **Required** clear for now.
9. Select **Save single sign-on**, and give your authenticator code when asked. The page says **Saved**.

A secret or certificate already saved shows **Saved. Leave it blank to keep it.**; leave the box blank to keep it.

### Prove your domains

10. Under **Prove your domains**, each domain shows **Not verified yet** with a **TXT record name** and **TXT record value**.
11. At your DNS provider, add a TXT record with that name and value.
12. Select **Check now**. The page says, for example, **example.in is verified.** DNS can take a while to spread; check again later if it isn't found.

### Try it, then require it

13. In a private browser window, open the portal's **Sign in** page, choose **Company SSO**, type your **Work email** and select **Continue**. You go to your provider's sign-in and come back signed in. If your role needs an authenticator and your provider didn't ask for a second factor, the portal asks for your authenticator code too.
14. Once sign-in works for every domain, tick **Required** and save again. People in these domains then can't sign in to the portal with a code; phones still can.

## What the system checks

- Single sign-on signs in only addresses at domains you have proved with the TXT record, and only people whose work email on their profile matches. Nobody is created by it.
- A domain proved by another organisation stays theirs.
- **Required** refuses web codes for every email in the listed domains, proved or not. Prove and test each domain before ticking it, or people at a domain not yet proved can't sign in to the portal at all.
- While the **Single sign-on** module is off, nobody signs in through your provider and everyone uses a code; the connection is kept.
- The sign-in comes back to the browser that started it, and SAML answers must match a request the product sent.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **No TXT record with the token was found at … yet** | DNS doesn't show the record yet. | Check the name and value at your DNS provider, wait, then **Check now** again. |
| This changed somewhere else. Refresh and try again. | Another organisation proved that domain first. | Ask the vendor. |
| Some details need fixing. Check the highlighted fields. | A field is wrong, such as an issuer address the product can't reach. The field says why. | Correct it and save again. |
| Sign in again with your authenticator to open this organisation. | You cancelled **Confirm it’s you**, or its code was refused. | Save again and give a current code. |
| The sign-in took too long. Try again. | (On the sign-in page.) The trip to the provider timed out. | Try again. |
| Your organisation’s sign-in didn’t complete. Try again, or ask your administrator. | The provider refused, or its answer didn't check out. | Check the provider's settings and the certificate or secret. |
| That email isn’t one your organisation signs in with SSO. | The email's domain isn't proved. | Prove it under **Prove your domains**. |
| Nobody here has that work email. Ask your administrator to add it to your profile. | No person has that email. | Add it on their profile ([Add and look after people](people.md)). |
| Single sign-on isn’t available for your organisation right now. Sign in with your mobile number. | The module is off. | Switch it on ([Switch modules on and off](modules.md)). |
| Your organisation doesn’t use single sign-on for this email. Sign in with your mobile number. | No connection is on for that email's domain. | Tick **On**, or sign in with the mobile number. |

The bold message comes from the server, in English.

## Waiting on the owner

- SMS codes in production need MSG91 and DLT registration.
- Problems the server describes come in English only (D42).
