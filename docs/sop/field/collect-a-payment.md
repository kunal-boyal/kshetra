# Collect a payment

| | |
|---|---|
| **Who** | Field user, Manager (`collection.record`; seeing open invoices needs `finance.view`) |
| **Where** | Field app › an account's screen › **Collect payment**; Field app › **More** › **My collections** |
| **Module** | Account finance |
| **Related** | [Visit an account](visit-an-account.md), [Use the upload queue](upload-queue.md) |

When an account pays you, record the money on the phone: cash, UPI, cheque or bank transfer. The office confirms it later and matches it to the receipt in the books. You can send the account a receipt that says the office has yet to confirm it.

## Before you start

- The Account finance module is on and the account is active.
- Recording works offline. What the account owes comes from the phone's copy of its balance and collections; its open invoices and which of them the money settles first need signal.
- Location is on: a collection records where it was taken.
- Your admin sets the cash limit for one account in a day (₹2,00,000 by default, the Income-tax Act's limit), or turns it off.

## Steps

1. On the account's screen, tap **Collect payment** (under **On this visit** or **To do here**). It shows what the account owes, such as **… outstanding · … overdue**.
2. If money collected earlier isn't in the books yet, a card shows **Collected, not yet in the books** and **Left after it**. With signal, **Open invoices** lists each invoice with **Due …** or **… days late**.
3. Type the **Amount**. With open invoices, the screen says **Settles … first.**, and **… more than the open invoices, kept as an advance.** when it is more.
4. Under **Paid by**, choose **Cash**, **UPI**, **Cheque** or **Bank transfer**.
   - **UPI** or **Bank transfer**: fill **Reference** (the transaction ID on the payer's phone, or the transfer's UTR or reference number).
   - **Cheque**: fill **Cheque number** and **Bank**, check **Date on the cheque** (it starts at today: **Dated …. Pick another day below if the cheque says otherwise.**), and tap **Photograph the cheque**. Up to three photos.
   - **Cash**: nothing more, but the limit applies.
5. Add a **Note** for the office if you need to (**Optional, for the office**).
6. Tap **Save …** with the amount (**Save the collection** until you type one).
7. The screen says **Saved … from …. It goes to the office once it uploads, and counts once confirmed.**
8. To send the account a receipt, tap **Share receipt** and choose WhatsApp, SMS or another app. The receipt says **Payment received**, the amount, account, date and mode, **Collected by** you, and **Awaiting the office’s confirmation.**
9. Tap **Done**.

### My collections

1. Open **More** › **My collections**.
2. The top shows **Collected this month** and **Waiting for the office**.
3. Each collection of the last 60 days shows its number (or **On this phone** before it uploads), amount and mode, and where it stands: **Waiting to upload**, **Waiting for the office**, **Confirmed**, **In the books**, **Rejected** or **Bounced**. A rejected or bounced one says **Why: …**.
4. Tap **Share receipt** on a collection to send its receipt again.

## What the system checks

- The amount is above zero (BR-63, `collectionIssues()`).
- UPI and bank transfers need a reference; a cheque needs its number, bank, date and at least one photo.
- Cash from one account in a day, this collection included, must stay under the limit: reaching it is refused. Rejected collections don't count toward it.
- A collection can't be dated after today; the phone's clock is checked.
- A collection never becomes a receipt in the books by itself. The office confirms it, and it moves to **In the books** once a receipt in the books matches it.
- A collection taken in a visit uploads after the visit's check-in, and after its cheque photos.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Enter an amount above zero, such as 1250 or 1250.50** | No amount, or not a number | Type the amount |
| **Enter the payment’s reference** | UPI or transfer without a reference | Type the reference |
| **Enter the cheque number**, **Enter the cheque’s bank**, **Pick the date on the cheque** | The cheque's details are missing | Fill them in |
| **Take a photo of the cheque** | No photo of the cheque | Tap **Photograph the cheque** |
| **Cash from one account in a day must stay under …. … in cash taken here today already.** | Over the cash limit | Take the rest another way |
| **This is later than today. Check the phone’s clock** | The phone's date is ahead | Correct the phone's date and time |
| **Allow location to record this payment.** | Location is off for the app | Allow location for the app, then save again |
| **This could not be saved on the phone. Try again.** | The phone couldn't save | Try again |

