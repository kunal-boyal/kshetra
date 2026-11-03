# Bill a tenant

| | |
|---|---|
| **Who** | Finance or Platform admin (`platform.billing.manage`); every staff member reads billing |
| **Where** | Console › a tenant's page › **Billing**; Console › **Billing** (under **Money**) › an invoice; **Billing** › **Billing settings** |
| **Related** | [Manage plans and a tenant's usage](plans-and-usage.md), [Suspend or terminate a tenant](suspend-terminate-a-tenant.md), [the tenant admin's procedures](../admin/README.md) |

The vendor bills each tenant for the seats it uses: monthly in arrears, or annually upfront for committed seats. The billing job runs every hour on India's clock: it issues invoices, renews and trues up annual terms, charges automatic payments, follows up unpaid tenants and ends trials. Everything it does checks what was done before, so nothing happens twice. Your part is the tenant's billing details, its subscription, payments received by transfer, and the seller's settings.

## Before you start

- The seller's details are set in **Billing settings** (see the last section). Until they are, no invoice can be issued, and **Billing** says "Invoices can’t be issued until the seller’s details are set in billing settings."
- The tenant is on the plan you mean to bill ([Manage plans and a tenant's usage](plans-and-usage.md)).

## Add the tenant's billing details

1. On the tenant's page, in **Billing** › **Billing details**, select **Add billing details** (or **Edit billing details**).
2. Enter **Legal name**, **GSTIN** (leave it blank if the tenant isn't registered for GST), **Address**, **Place of supply** (its state), **Billing email** and **Language of billing emails**.
3. Select **Save**.

The tenant's admin can enter the same details in the portal's Settings › Billing. The place of supply decides the tax: the seller's own state gets CGST and SGST at half the rate each; any other state gets IGST at the full rate (BR-47).

## Start a subscription

1. In **Billing** › **Subscription**, select **Start a subscription**. (It appears once the billing details are in.)
2. Choose the **Plan**; each shows its prices per person.
3. Choose **Billed**:
   - **Monthly, in arrears**: each month is invoiced from the 4th of the next, for the seats used in it (BR-45).
   - **Annually, upfront**: enter **Seats committed**. The year's invoice for those seats at the annual price is issued at once. Each quarter, seats above the commitment are invoiced for the rest of the term and join the commitment (BR-47).
4. Choose **Starts on**, within a month of today either way.
5. Select **Subscribe**. The tenant goes on the plan, and a tenant on trial or suspended opens as Active.

To move a monthly subscription to another plan, select **Change the subscribed plan**, choose the **Plan** and select **Save**: the next invoice follows it. An annual subscription changes only at its renewal.

## Cancel a subscription

1. Select **Cancel the subscription**. The console asks to confirm: a monthly one ends today and an annual one at its term's end; the tenant is suspended once it ends.
2. Enter **Why**, then select **Cancel the subscription** again.

After the last day, once the last month is invoiced, the billing job closes the subscription and suspends the tenant. Nothing is deleted; [Suspend or terminate a tenant](suspend-terminate-a-tenant.md) covers what follows.

## Set up automatic payment

1. In **Billing** › **Automatic payment**, select **Set up automatic payment**.
2. Send the link the console shows to the billing contact. Once they authorise it, the status says "Active: invoices are charged when issued." The billing contact can also start it from the portal's Settings › Billing.

Until Razorpay is in place this is refused in production (see the table), and every invoice is paid by bank transfer.

## Record a payment received by transfer

1. Open **Billing**. Filter the invoices by **Status** (Unpaid or Paid; **Any invoice** for all). Each row shows **Number**, **Tenant**, **Plan**, **For** (Month, Annual term or True-up), **Period**, **Issued**, **Due**, **Total**, **Status** (Paid, Unpaid or Overdue) and **Next step**. A tenant's own invoices are also on its page.
2. Select the invoice's number. Its page shows who it bills, the lines, the taxable value, the tax, the **Total**, what is **Paid** and what is **Still owed**. **Download the PDF** saves it.
3. Under **Record a payment**, check **Amount (₹)** (it starts at what is owed), choose the **Method** (Bank transfer, Cheque, UPI or Other), enter the **Reference** (the bank's reference, optional) and **Received on**.
4. Select **Record a payment**. It appears under **Payments**. When the invoice is paid in full, its status turns to Paid.

## Follow an unpaid tenant

An invoice unpaid after its due day, or a refused automatic charge, makes the tenant overdue (BR-48):

| Stage | When | What the tenant's people can do |
|---|---|---|
| Grace period | From the day it fell overdue, for the days of grace | Everything |
| Read only | Then, for the days read only | Look, but record nothing |
| Suspended | After that | Nobody signs in. Nothing is deleted |

- The tenant's billing card says where it stands, for example "Overdue since {date}: in grace until {date}, then read only.", with what is **Outstanding**. **Next step** on **Billing** says the same for each invoice: "Read only from {date}", "Read only; suspended from {date}" or "Suspended since {date}; data kept".
- The billing contact and the tenant's admins are emailed when it falls overdue, on days 3 and 6 of grace, when it turns read only, three days before suspension, and on suspension.
- Recording the payment moves a tenant in grace or read only back to Active at once. A suspended tenant stays suspended until someone with `platform.tenant.manage` selects **Reactivate** on its page ([Suspend or terminate a tenant](suspend-terminate-a-tenant.md)). A reactivated tenant stays open while you sort the payment out; it moves again only when its stage changes.

## Keep the billing settings

1. On **Billing**, select **Billing settings**.
2. Under **Seller**: **Legal name**, **GSTIN**, **Address**, **State**, **Billing email**, **SAC code** (six digits, as the vendor's chartered accountant confirms), **Invoice prefix** (up to 4 capital letters) and **GST rate (%)**.
3. Under **Following up unpaid tenants**: **Days to pay by transfer** (when an invoice falls due), **Days of grace** and **Days read only before suspension**.
4. Select **Save the settings**. It says **Saved**.

On a local, test or demo database the settings are fictional example details. **Billing** then says "These are fictional example details. Invoices issued on them say they are not tax invoices, and production refuses them.", and each invoice says "Issued on the example seller: not a tax invoice."

## What the system checks

- Invoice numbers run in one gapless series per financial year (April to March), such as `<PREFIX>/26-27/00042`. An issued invoice never changes; its PDF is drawn from it on request.
- GST is worked out on the subtotal, each tax rounded to the paisa (BR-47). A GSTIN is checked for its shape, its state (it must match the place of supply) and its check character.
- A payment is never more than the invoice still owes, and recording the same payment twice records it once.
- A live production cell refuses to invoice on the example seller or without the seller's GSTIN.
- Every change is recorded in the platform audit.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Invoices can’t be issued until the seller’s details are set in billing settings. | The seller's details are incomplete | Complete **Billing settings** |
| This changed somewhere else. Refresh and try again. | One of: the billing details are missing; the seller's details aren't ready (or are the example on production); automatic payment isn't available yet; an annual subscription can't change before renewal; the current subscription is ending; the tenant is terminated; there is no subscription to cancel | Check each in turn. For automatic payment, record transfers instead. For an ending subscription, start the new one after it ends |
| Under **Starts on**: "Start within a month of today" | The start date is too far away | Choose a date within 31 days of today |
| Under **Amount (₹)**: "Enter an amount up to …, which is what is owed" | The amount is more than the invoice owes, or nothing | Enter what was received on this invoice, up to what it owes |
| Under **GSTIN**: "The GSTIN is for another state", "Check the GSTIN for a typing error" or "Enter the 15-character GSTIN" | The GSTIN doesn't check out | Check it against the customer's registration and the **Place of supply** |
| Under **SAC code**: "Enter the 6-digit SAC code"; under **Invoice prefix**: "Use 1 to 4 capital letters" | A setting's shape is wrong | Fix it |
| This request was already sent with different details. Start it again. | A payment with the same ID was recorded with another amount | Reload the invoice and record it again |
| You don't have access to this. | Your role can't change billing; the forms are hidden or read only for you | Ask Finance or a platform admin |

## Waiting on the owner

- Razorpay: `PAYMENT_PROVIDER` is `off` in production, so **Set up automatic payment** is refused and every invoice is paid by transfer. Test keys first, live keys once prices are set and the company exists.
- D3: seat prices and plan contents; the example plans carry fictional prices.
- The company's own seller details: its legal name, address, GSTIN and the SAC code its chartered accountant confirms, before any production invoice.
- Amazon SES out of its sandbox: until then invoice, overdue and trial emails don't reach customers in production.
