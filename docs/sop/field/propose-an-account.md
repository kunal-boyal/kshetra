# Propose a new account

| | |
|---|---|
| **Who** | Field user, Manager (`account.propose`) |
| **Where** | Field app › **More** › **Accounts** › **Propose a new …** |
| **Module** | Core |
| **Related** | [Visit an account](visit-an-account.md), [Fill a form](fill-a-form.md) |

When you find a new shop, farmer or doctor that isn't on your list, you propose it from the phone. Your manager decides it; until then it shows on your phone as waiting for approval.

## Before you start

- Your admin lets field people propose that account type: its **Who adds them** is **Field users, with approval**. Only those types get a button.
- Proposing works offline: the proposal is saved on the phone and uploads when there is signal.

## Steps

1. Open **More** › **Accounts**.
2. Tap **Propose a new …** for the type, such as **Propose a new Retailer** in the agri template.
3. The screen says **Your manager decides it. Until then it shows as waiting for approval.**
4. Fill **Name**.
5. Where the type's codes are typed by hand, fill **Code**. Otherwise the system gives it a code.
6. Choose its **Territory**.
7. Fill the type's own fields, if it has any.
8. Standing at the place, tap **Add where it is, from my location**. It says **Location added, known to within … m.** This is optional, and the location stays **Not verified** until a location is approved.
9. Tap **Send for approval**.
10. The new account's screen opens, marked **Waiting for approval**. It also shows in **Accounts** with **Waiting for approval**.

Your manager approves or rejects it from their **Team** tab or the portal. Once approved, it becomes active and you can visit it, take orders there and the rest.

## What the system checks

- A name is needed; a typed code is up to 40 letters, digits, dots, dashes or slashes; a territory is needed.
- The type's own fields are checked as the form engine checks them.
- Someone who approves accounts (`account.approve`, held by managers) decides it; nobody approves their own proposal.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Fill in the name** | No name | Type the name |
| **Write a code of up to 40 letters, digits, dots, dashes or slashes** | The code is missing or has other characters | Correct the code |
| **Choose the territory** | No territory chosen | Choose one |
| **Location is off for this app. Allow it in the phone settings.** | Location is off | Allow it, or send without a location |
| **This could not be saved on the phone. Try again.** | The phone couldn't save | Try again |
| No **Propose a new …** button | Your role or the type doesn't allow proposing | Ask your manager or admin |
