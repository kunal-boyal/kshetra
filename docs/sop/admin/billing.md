# Check your plan, billing details and invoices

| | |
|---|---|
| **Who** | Admin (`billing.manage`) |
| **Where** | Web portal › **Settings** › **Organisation** › **Billing** |
| **Module** | Core |
| **Related** | [Switch modules on and off](modules.md), [Add and look after people](people.md) |

Billing shows your plan and the people it covers, where your organisation stands if a payment is overdue, how you pay, your billing details, your usage and your invoices. The vendor sets the plan and issues the invoices; you keep your billing details right and pay.

## Before you start

- Have your legal name, GSTIN (if registered), address, state and the email that should receive invoices.

## Steps

### Read your plan

1. Open **Settings** › **Organisation** › **Billing**.
2. **Your plan** shows the plan's name, its price a month or a year, when it renews, ends or when your trial ends, and its modules. Without a plan it says **No plan yet: every module is open.**
3. **People active** shows how many people are active against the plan's limit, and how many seats are left.
4. **Subscription** shows how you are **Billed** (**Monthly, for the seats used in each month** or **Annually, upfront**), when it **Started**, the **Current term** and the **Seats paid for**.

### Add or change your billing details

1. Under **Billing details**, select **Add billing details** (or **Change the billing details**).
2. Fill **Legal name**, **GSTIN** (leave it blank if you aren't registered for GST), **Address**, **State (place of supply)**, **Email for invoices** and **Language of billing emails**.
3. Select **Save the billing details**.

Your state decides whether GST is charged as CGST and SGST, or as IGST. Change details before the next invoice: issued invoices never change.

### Pay

1. **How you pay** says how invoices are paid: today, **By bank transfer, quoting the invoice number.**
2. Under **Invoices**, each invoice shows its **Number**, **Period**, **Total** and **Status**: **Paid** with the date, **Due** with the date, or **Overdue**.
3. Select **PDF** on a row to download the invoice.

### Read your usage

**Usage** shows, by **Month**, the **Seats**, **SMS**, **WhatsApp** and **Storage** your organisation used.

## What the system checks

- Seats: adding or reactivating a person past the plan's limit is refused (BR-45). Billable seats are counted from people's active days in the month.
- When an invoice is overdue, a notice at the top of this page says how much and since when. People can keep working until a date; after it your organisation can only read until it is paid, and later it is suspended (BR-48, `dunning()`).
- Invoices are numbered in an unbroken series and never change once issued.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **{amount} has been overdue since {since}. Everyone can keep working until {readOnly}; after that your organisation can only read until it is paid.** | An invoice is overdue. | Pay it by bank transfer, quoting its number. |
| Your organisation's subscription is read-only for now. Ask an admin about billing. | Payment is overdue past the grace period; changes are refused everywhere. | Pay the overdue invoice; this page still works. |
| Your organisation's subscription is suspended. Ask an admin about billing. | Payment is long overdue. | Call the vendor. |
| No subscription yet. Contact us to subscribe before your trial ends. | You are on a trial. | Ask the vendor to set up your subscription. |
| Your organisation has used all its seats. Ask an admin to add more. | The seat limit is reached. | Deactivate leavers, or ask the vendor for more seats. |

## Waiting on the owner

- Automatic payment waits on a Razorpay account; until then the page says **Automatic payment arrives soon; until then, pay by bank transfer.**
- Seat prices and plan contents are not set yet (D3); demo plans carry fictional prices.
- Billing emails need Amazon SES out of its sandbox in production.
