# Sign in and look after your account

| | |
|---|---|
| **Who** | Every vendor staff member |
| **Where** | Console › the setup link; the sign-in page; **Your account** |
| **Related** | [Manage staff](manage-staff.md) |

You sign in to the console with three things together: your work email, your password and a six-digit code from an authenticator app on your phone. You set the password and the authenticator once, from the setup link a platform admin sends you.

## Before you start

- A platform admin has invited you and sent you your setup link ([Manage staff](manage-staff.md)). The link works for 72 hours.
- An authenticator app on your phone (any app that reads a QR code for time-based codes), with the phone's clock set automatically.
- A password manager, to make and keep a long password.

## Set up from your link

1. Open the setup link. The page says **Set up your sign-in**.
2. In **New password**, enter a password of at least 12 characters. Enter it again in **The password again**, then select **Continue**.
3. The page now says **Add an authenticator**. Scan the QR code with your authenticator app. If you can't scan it, type the **Setup key** into the app by hand, or, on the phone itself, select **Open in an authenticator app**.
4. Enter the six digits the app shows now in **Authenticator code**, then select **Finish setting up**.
5. The page says **You are set up**. Select **Sign in** and sign in as below.

The setup key is shown only on this page. Keep it in the authenticator app and nowhere else. If you lose the page before step 4, open the same link again: until a code confirms the authenticator, the link starts the setup afresh with a new key.

## Sign in

1. Open the console. The page says **Sign in to the console**.
2. Enter **Email** (the address you were invited with), **Password**, and the six digits your app shows now in **Authenticator code**.
3. Select **Sign in**. The console opens on **Tenants**.

Your name, role and "two-step sign-in on" show at the foot of the rail. A session lasts 12 hours, a working day; after that, sign in again. **Sign out**, in the bar at the top, ends the session at once.

## Change your password

1. Select **Your account** in the bar at the top. The page shows **Change your password**.
2. Enter **Current password**, then the new one in **New password** and **The password again**.
3. Enter a fresh code in **Authenticator code**.
4. Select **Change password**. The page says "Your password is changed, and your other sessions have ended." This session goes on; sign in again anywhere else.

You can't change your authenticator yourself. If you lose it, or your password, ask another platform admin to reset your sign-in ([Manage staff](manage-staff.md)); nobody resets their own.

## What the system checks

- A new password has at least 12 characters, leaves out your name, your email and the product's name, and isn't one known from a data breach (checked against Have I Been Pwned's range service, which never receives the password itself).
- A code is the current one or the one just before it, and each code works once. A code used to sign in can't be used again to change the password; wait for the next.
- Every wrong email, password or code gets the same answer, so the page never says which part was wrong. Ten wrong tries lock the account for 15 minutes, and a locked account answers as a wrong try does. Sign-ins are also limited per address and per email.
- A disabled account, or one whose sign-in was reset, can't sign in, and its sessions end at once.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| This setup link has expired or been used. Ask a platform admin for a new one. | The link is older than 72 hours, was already used to finish setting up, or was replaced by a newer one | Ask a platform admin to invite you again (while you are still Invited) or to reset your sign-in |
| The two passwords differ | **New password** and **The password again** don't match | Type both again |
| Under the password: "Leave out your name, your email and the product’s name" or "This password is known from a data breach; choose another" | The new password is refused | Choose another; let your password manager make one |
| Under the code: "That code is not right; check the time on your phone" | The first code doesn't match the key | Set the phone's time to automatic, wait for a new code and try again |
| Check your email, password and authenticator code. | One of the three is wrong, or the account is locked after ten wrong tries, disabled or not set up | Check all three with a fresh code. After repeated failures, wait 15 minutes. If it still fails, ask a platform admin to check your status on **Staff** |
| Too many attempts. Wait a moment, then try again. | Too many sign-ins from your address or for your email | Wait, then try once, carefully |
| Under **Current password**: "Check your current password and authenticator code" | The current password or the code was wrong | Enter both again with a fresh code |
| Under **New password**: "Choose a password other than your current one" | The new password is the old one | Choose another |
| You have been signed out. Sign in again. | Your 12 hours are over, or your password was changed, your sign-in reset or your account disabled | Sign in again; if you can't, ask a platform admin |
