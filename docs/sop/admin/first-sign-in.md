# Sign in to the portal for the first time

| | |
|---|---|
| **Who** | The organisation's first admin: role Admin (`settings.manage`, `user.manage`, `role.manage` and every other permission) |
| **Where** | Web portal › **Sign in**; afterwards your profile menu › **Sign-in security** |
| **Module** | Core |
| **Related** | [Set up the organisation and its brand](organisation-and-branding.md), [Set up sign-in security and single sign-on](security-and-sso.md), [Add and look after people](people.md) |

You sign in with your mobile number and a one-time code, then set up an authenticator app, because your role can change who does what. Do this once, on a computer, with your phone beside you.

## Before you start

The vendor has already done this for you, in their console:

- Created your organisation from an industry template (agri, pharma, FMCG, building or generic). The template brought your starting roles, designations, territory levels, account types, forms, metrics and words.
- Added you as the first admin, with your name, your mobile number and, if you gave one, your email. You hold the role Admin and your organisation's highest designation (for example Business Head).
- Given you the portal's web address.

You need:

- The mobile number the vendor added for you, and that phone, to receive the code.
- An authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.
- Somewhere safe to keep ten recovery codes, away from your phone.

## Steps

### Sign in with your mobile number

1. Open the portal's address. The **Sign in** page opens, with **Sign in with** set to **Mobile number**.
2. In **Mobile number**, type your ten-digit number, without +91 or 0.
3. Select **Send code**. The code arrives by SMS.
4. In **Code**, type the six-digit code, then select **Sign in**.
   - No code? Wait until the countdown ends, then select **Send a new code**.
   - Wrong number? Select **Use a different number**.

### Set up your authenticator (first time only)

5. The page now says **Set up your authenticator**. Open your authenticator app and scan the QR code. If you can't scan, add an account in the app and type the key shown under **Or type this key into the app**.
6. In **Authenticator code**, type the six digits the app shows now, then select **Confirm and sign in**. Do this within five minutes of entering the SMS code.
7. The page shows **Save your recovery codes**: ten codes, each of which signs you in once if you lose your phone. Select **Copy the codes** and store them in a password manager, or write them down. They are shown only now.
8. Select **I have saved them**. Your Home page opens.

### Every sign-in after this

1. Enter your mobile number and the SMS code as above.
2. At **Enter your authenticator code**, type the code from the app and select **Sign in**.
3. If your phone is lost, select **Use a recovery code instead**, type one of your saved codes in **Recovery code**, and select **Sign in**. Each code works once.

### Check your sign-in security and sessions

1. Select your picture at the top of the page (**Your profile and settings**), then **Sign-in security**.
2. Under **Authenticator app**, the status is **On**. Because your role needs an authenticator, the page says it stays on and there is no way to turn it off.
3. Under **Where you’re signed in**, check the list of browsers and phones signed in as you, with their **Address**, **Signed in** and **Last active** times. **This browser** marks the one you are using.
4. To end one you don't recognise, select **End** on its row, then **End** again to confirm. To end all the others, select **Sign out everywhere else** and confirm.

## What the system checks

- The mobile number must be ten digits starting with 6, 7, 8 or 9. The page says so before anything is sent (`normaliseMobile()`).
- A number may ask for three codes every ten minutes. Wrong codes are limited to ten an hour and twenty a day for one number.
- You can ask for a new code 30 seconds after the last one.
- The authenticator step must be finished within five minutes of the SMS code, with at most five wrong tries. After that you start again with a new SMS code.
- Anyone whose role holds `role.manage`, `user.manage`, `settings.manage`, `module.manage`, `billing.manage` or `erp.manage` must give an authenticator code on the web (`SECOND_FACTOR_PERMISSIONS`). Phones never ask for it.
- A web session ends after 12 hours without use, and after 7 days at most (`sessionExpiresAt()`).
- A number belongs to one organisation at a time, so the code signs you straight into yours; nothing asks you to choose an organisation.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Enter a 10-digit mobile number, such as 98765 43210. | The number isn't a valid Indian mobile number. | Type the ten digits without +91 or 0. |
| That code is not right. Check it and try again. | The SMS code is wrong. | Check the latest SMS and type it again. |
| This code has expired. Ask for a new one. | The SMS code ran out, or the authenticator step took too long or had too many wrong tries. | Select **Send a new code** and start again. |
| Too many attempts. Wait a moment, then try again. | The limits above were reached. | Wait ten minutes, then try again. |
| Use the mobile app for this. | Your role is marked **Mobile app only**. | Ask another admin to give you a role that can use the web. |
| Your organisation signs you in with its own sign-in. Enter your work email to continue. | Single sign-on is required for your email's domain. | Enter your **Work email** and select **Continue**. See [Set up sign-in security and single sign-on](security-and-sso.md). |
| You lost your phone and your recovery codes. | Nobody can bypass the authenticator. | Ask another admin to open your page in **People** and select **Reset the authenticator**. If you are the only admin, call the vendor: they confirm who you are and reset it from their console. You set up a new authenticator at your next sign-in. |

## Waiting on the owner

- SMS codes in production need an MSG91 account and DLT registration of the sender and the code template. Until then the vendor can't send codes to real phones outside a demo.
- The Hindi text on these screens awaits a native speaker's review.
