# Set up schemes

| | |
|---|---|
| **Who** | Admin or Business head (`scheme.manage`) |
| **Where** | Web portal › **Settings** › **Commerce** › **Schemes** |
| **Module** | **Orders** (the tenant's word for orders) |
| **Related** | [Keep the catalogue and price lists](catalogue-and-price-lists.md), [Take an order](../field/place-an-order.md) |

A scheme gives a discount or free goods on orders. Each order line takes the one scheme best for the account, worked out the same way on the phone, at the order desk and on the server. Set a scheme up before it starts, and switch it off when it should stop early.

## Before you start

- The items the scheme is for are in the catalogue and active. Only active items can be chosen.
- The items have prices for the accounts concerned. A percentage or amount comes off the line's value, so a line with no price gets nothing.
- Decide the scheme's **Key** now. It can't be changed later.

## Steps

1. Open **Settings** › **Commerce** › **Schemes**. The table lists each **Scheme** with its key, what it **Gives**, whom it **Reaches**, when it **Applies** and its **Status**.
2. Select **Add a scheme**, or select a scheme's name to change it.
3. Under **What it gives**, fill in:
   - **Key**: lowercase letters, digits and underscores. It never changes.
   - **Name in English** and **Name in Hindi**. If you leave the Hindi name empty, the English one is used.
   - **Kind**, then what that kind needs:
     - **Percentage off**: **Percent off**, more than 0 and at most 100.
     - **Amount off each unit**: **Amount off each unit**, taken off each base unit, never more than the line is worth.
     - **Quantity slabs**: one row per slab, with **Slab 1: from units** and **Slab 1: percent off**. Select **Add a slab** for the next (at most 10); **Remove slab 2** takes one out. Each slab starts higher and gives more than the one before.
     - **Free goods**: **For every (base units)**, **Free (base units)**, and the **Free item**. Leave **Free item** as **The same item** to give more of what was ordered.
4. Check the **Example line**. Change **Base units** and **Rate per unit** to see what the scheme gives a line, for example "₹500.00 off, leaving ₹9,500.00 before tax" or "10 units free". Until the rule is complete it says "Fill in what the scheme gives to see it worked out." The line under it repeats what the scheme gives in a few words, as the list shows it.
5. Under **Whom it reaches**, tick what the scheme is for. Leave a list empty to reach every one.
   - **Items** and **Categories**: an item is reached when it or its category is chosen. With both empty, every item is reached.
   - **Account types**: only accounts of these types.
   - **Territories**: a territory reaches every territory under it. Use **Find a territory** on a long list.
6. Under **When**, fill in **First day** and, if it ends, **Last day**. Leave **Last day** empty to keep it going.
7. Leave **Active** ticked, then select **Add a scheme** (new) or **Save** (existing). You see **Saved.**

To stop a scheme early, open it, untick **Active** and select **Save**. Schemes are never deleted, so past orders still name theirs.

## What the system checks

- A scheme reaches a line when it is active, the order's day is between its first and last days, and the line's item, the account's type and the account's territory are all within what it reaches (BR-55, `schemeApplies()`).
- Each line takes at most one scheme: the one worth most to the account. A discount counts at its amount; free goods count at the free item's net rate for that account. Between schemes worth the same, the one that started earlier wins, then the lower key, so every device chooses the same one (BR-55, `chooseSchemes()`).
- **Quantity slabs** count the base units of every line the scheme reaches in the same order, not just the one line, to choose the slab. The slab's percent then comes off each of those lines.
- **Free goods** count the line's own base units in whole multiples: with 10 free for every 100, a line of 250 gets 20 free. Free goods are their own lines at price 0.
- The discount comes off the line's value before tax, so tax and total follow the lower value (`afterScheme()`).
- The server works the schemes out again for every order. If a phone quoted a different scheme or free goods, the order is refused with the prices-changed message and the person checks the cart again.
- A key is used once and never changes; the last day is on or after the first; every item, category, account type and territory named must exist.
- Every change is made at the version you opened.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A field broke a rule, such as a slab that doesn't start above the one before. The reason shows under the field. | Fix the field and save again. |
| This changed somewhere else. Refresh and try again. | Someone saved the scheme after you opened it. | Reload and make your change again. |
| There is no such scheme. | The link points to a scheme that isn't there. | Go back to **Schemes**. |
| None to choose from. | There are no active items, categories, types or territories of that kind yet. | Add them first, or leave that list empty. |
| A line gets a different scheme than expected | Another scheme reaches it and is worth more to the account. | Compare the schemes' reach and dates; switch off the one that shouldn't apply. |

## Waiting on the owner

- The scheme engine was built from our own design. It still needs checking against three or four real schemes or promotions (discounts, slabs, free goods) from agri, pharma or FMCG, which Kunal is to supply.
- The field-error texts the server sends are in English only.
