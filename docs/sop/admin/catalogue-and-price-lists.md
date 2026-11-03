# Keep the catalogue and price lists

| | |
|---|---|
| **Who** | Admin or Business head (`catalogue.manage`, `price_list.manage`; `import.run` to import items) |
| **Where** | Web portal › **Settings** › **Commerce** › **Catalogue** and **Price lists** |
| **Module** | Core for the catalogue; **Orders** (the tenant's word for orders) for price lists |
| **Related** | [Set up schemes](schemes.md), [Connect your books](erp-connections.md), [Connect your systems with API clients and webhooks](api-clients-and-webhooks.md), [Take an order](../field/place-an-order.md) |

The catalogue is what your organisation sells: items grouped by product and category, with their units and tax. Prices are not kept on items; they are kept on price lists, and the most specific list that applies to an account prices each item. Do this before anyone takes orders, and whenever items or prices change.

## Before you start

- The units items are sold in (piece, case and so on), which one is the base, the measures totalled on orders (kg, L), the rounding rule and the order rejection reasons come from your template. They are not edited on these pages. To change them, export the configuration from **Settings** › **Data** › **Export and import**, change its `catalogue` section, and import it again.
- Price lists need the **Orders** module switched on. Without it, **Price lists** is not in the menu.
- If your books are in Zoho Books, SAP Business One or Tally, items and prices can come in from there instead. See [Connect your books](erp-connections.md).

## Steps

### Add or change an item

1. Open **Settings** › **Commerce** › **Catalogue**. The page lists every item with its **Product**, **Pack**, **Units**, **Tax**, **HSN code**, **MRP** and **Status**. Use **Find by code, name, product or category** to narrow it.
2. Select **Add an item**, or select an item's name to change it.
3. Under **The item**, fill in:
   - **Item code** and **Item name**. Each code is used once.
   - **Product**. Items of the same product are grouped together; a new name adds the product.
   - **Category** (optional).
   - **Pack**, as printed, such as 500 ML or 1 KG.
   - **HSN code** (optional) and **Tax rate (%)**.
   - **MRP** (optional). It is shown only; prices come from price lists.
4. Under **Units**, choose the **Base unit**. Prices are per base unit. For each other unit the item is sold in, fill in how many base units it holds (the field reads, for example, "Pieces in a Case"). Leave a unit empty if the item isn't sold that way.
5. If your catalogue keeps measures, choose the **Measure** and fill in **Measure in one** base unit. The measure must agree with the pack label: an item labelled 500 ML must hold 0.5 L per base unit (BR-16).
6. Fill in **More about the item** if your organisation has item fields.
7. Leave **Active** ticked. Switched off, it can't be ordered or chosen in new forms, but past records keep it.
8. Select **Add an item** (new) or **Save** (existing).

To load many items at once, select **Import items**, which opens **Imports** with the **Catalogue items** target.

### Add a price list

1. Open **Settings** › **Commerce** › **Price lists**. The table shows each list, who it is **For**, when it **Applies**, its **Priority**, how many **Items** it prices and its **Status**.
2. Select **Add a price list**.
3. Under **The list**, fill in **Name**, then choose **For**:
   - **Everyone (default)**: prices every account no more specific list covers. Start with one of these.
   - **Account types**: tick **Which account types**.
   - **Segments**: tick **Which segments**.
   - **Territories**: tick **Which territories, with everything inside them**. Use **Find a territory** to narrow the list.
   - **Single accounts**: choose an **Account type**, type in **Find by name or code**, and tick each account. Chosen accounts show above; select one to take it out.
4. Set **Priority** (higher wins between lists equally specific), **First day** and, if it should stop, **Last day**. Leave **Last day** empty to keep it going.
5. Leave **Active** ticked and select **Add a price list**. The list's own page opens.

### Set prices on a list

1. Open the list from **Price lists**.
2. Under **Prices**, choose the **Item**, fill in **Price per base unit** and, if any, **Discount (%)**. The help under the discount shows the net rate it gives.
3. Select **Set the price**. Setting a price for an item already on the list changes it.
4. To change one, select **Change** beside it. To take one off, select **Remove**, then confirm. Accounts the list covers will then pay the next list's price for it, if another list has one.
5. Use **Find by item code or name** to find an item on a long list.

To change who a list is for, its dates or priority, change them under **The list** and select **Save**. You see **Saved.**

### See prices beside the catalogue

On **Catalogue**, each price list shows as a tab beside **All items**. A list's tab shows who it is **Used by**, when it is **In force**, how many **Items** it prices, and each item's **List price**, **Net rate**, **Tax** and **MRP**. Select **Change this list** to open it.

## What the system checks

- Which list prices an item for an account on a day (spec 5.11, `applicableLists()` and `priceFor()`):
  - Only active lists whose first and last days include the day count.
  - The most specific list wins: the account's own list, then its territory's (a nearer territory beats one above it), then its segment's, then its account type's, then the default.
  - Between lists equally specific, the higher **Priority** wins, then the list that started later.
  - An item missing from that list is priced by the next list that has it. An item no list prices has no price for that account.
- The net rate is the price less the discount, rounded to the paisa (BR-10). Amounts are worked out exactly, never with floating point.
- Rounding (BR-10) is the catalogue's `rounding` setting from the template: `per_unit_first` (the default) rounds each unit's net rate before multiplying by the quantity; `end` rounds only the line's total.
- An order keeps the prices of the day it was placed (BR-15). If a phone sends one after a price changed, the person is asked to accept the new total (BR-14).
- An order has at most 200 lines and each item once (BR-13).
- An item's code is used once; a unit appears once; a measure type and its amount are filled in together.
- A list's name is used once; its last day is on or after its first; a default list has no targets and any other list needs at least one.
- Every change is made at the version you opened. If someone else saved in between, you are told to refresh.
- Items and price lists are never deleted. Switch them off instead; a removed price keeps its record.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A field broke a rule, such as a code another item has. The reason shows under the field. | Fix the field and save again. |
| This changed somewhere else. Refresh and try again. | Someone saved the list or item after you opened it. | Reload the page and make your change again. |
| There is no such item. It may have been removed from the catalogue. | The link points to an item that isn't there. | Go back to **Catalogue** and find it by code. |
| This feature is switched off for your organisation. | The **Orders** module is off. | Switch it on in **Settings** › **Organisation** › **Modules**, if your plan includes it (see [Switch modules on and off](modules.md)). |
| An account pays an unexpected price | A more specific list, or a higher-priority list, applies. | Check its lists in the order above. On the phone, the account's prices screen shows what it pays. |

## Waiting on the owner

- The field-error texts the server sends (for example "Another item has this code") are in English only; how they reach Hindi readers is still to be decided.
