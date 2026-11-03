# Define account types

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Account types** (the tenant's word for account) |
| **Module** | Core |
| **Related** | [Add accounts and approve proposals](accounts.md), [Set up roles and designations](roles-and-designations.md), [Keep extra details about people](people-fields.md), [Forms](forms.md), [Rules](rules.md) |

An account type is a kind of account your people sell to or meet, such as Distributor, Retailer and Farmer in the agri template, or Doctor, Chemist, Stockist and Hospital in pharma. Each type has its own fields, slots for the people who look after it, and rules for codes and locations. Your template made the first ones.

## Before you start

- Set up designations first: each slot names the designations allowed in it ([Set up roles and designations](roles-and-designations.md)).
- Decide whether codes are typed in or numbered automatically. The key of a type never changes.

## Steps

1. Open **Settings** › **Field work** › **Account types**. The table lists each type's **Name**, **Key**, **Version**, number of **Fields** and **Status** (**In use** or **Switched off**).
2. Select **Add a type**, or a type's name to change it.

### Names

3. **Key** (new types only): lowercase letters, digits and underscores. It never changes once saved.
4. **Icon**: the name of a Lucide icon, such as `store` or `handshake`.
5. **Name for one, in English**, **Name for many, in English**, and the Hindi names. A blank Hindi name shows the English one.
6. **In use**: clear it to switch the type off. A switched-off type disappears from the accounts list's tabs and from imports.
7. **Keeps contact people**: tick it to keep contact people on each account.
   - **Gives a monthly sell-through statement** (the tenant's word for sell-through; **Gives a monthly liquidation statement** in agri): tick it for a type whose accounts give a stock statement each month, item by item, on the phone or the portal ([Record sell-through](../field/record-sell-through.md)).
   - **Holds stock** (shown only while the **Inventory** module is on): tick it for a type whose accounts keep stock. Its page then shows the stock item by item, people may count it on the phone, and orders supplied through it take from it once delivered ([Keep distributors' stock](../back-office/stock.md)). While **Inventory** is off the switch is hidden and the type keeps its setting.

### Codes, locations and who adds them

8. **Codes**: **Typed in**, or **Numbered automatically**, with a **Prefix** of 1 to 8 capital letters, digits or hyphens, such as `CUST`.
9. **Who adds them**: **Admins only**, or **Field users, with approval**. With approval, accounts proposed on phones wait in **Approvals** ([Add accounts and approve proposals](accounts.md)).
10. **Outside the boundary**: what forms that follow the type's policy do when someone is outside the geofence: **Not checked**, **Allowed, and flagged for review**, or **Refused**.
11. **Boundary radius, in metres**: from 50 to 5000. Leave it empty to use the organisation's default ([Rules](rules.md)).
12. **Every one needs a location**: tick it if each account must have coordinates.
13. **Field users may propose a location for one without it**: tick it to let field users propose a location, standing at the place, for an account that has none.
14. **May belong to**: tick the other types an account of this type may belong to, such as retailers belonging to a distributor.

### Slots

15. Slots are the people who look after each account, by designation. Select **Add a slot** for each.
16. Fill its **Key**, **Priority** (1 is the highest), **Label in English** and **Label in Hindi**.
17. Under **Designations allowed**, tick the designations that may fill it.
18. Tick **Must be filled** if every account needs someone in it.

The filled slot with the highest priority holds the account's primary person.

### Fields

19. Add the type's own fields with **Add a field**, as for people fields: **Key**, **Type**, labels, **Choices**, **Must be filled** ([Keep extra details about people](people-fields.md)).

### Segments and visits

20. A segment tags accounts whose fields match its rule, such as large retailers. Select **Add a segment**, fill its **Key** and labels, then build its rule from the type's fields. With no fields yet, the card says **Add a field first; a segment’s rule reads fields.**
21. Under **Visits expected each month**, select **Add a visit norm**, choose the **Segment** and the **Visits a month**.

### Save

22. Select **Add the type** for a new type, or **Publish the next version** for a change. The table shows the new version.
23. Phones get the new version at their next sync.

## What the system checks

- A type's key never changes, and a field keeps its type once any version used it.
- A type needs at least one slot, and at most 10 slots, 50 fields and 20 segments. Each slot names at least one designation that exists.
- A slot that someone fills can't be removed: empty it on every account first.
- The radius is 50 to 5000 metres; the prefix is 1 to 8 capital letters, digits or hyphens.
- Coordinates an admin types count as verified; a field user's proposal waits for approval.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | The type has problems; the list under the message names each, such as `definition.slots` with "Empty the `asm` slot first", in English from the server. | Correct each problem and save again. |
| This type could not be found. | The link is old, or the type was not saved. | Go back to **Account types** and open it again. |

## Waiting on the owner

- Problems the server describes come in English only (D42).
- The Hindi type names in the templates await a native speaker's review.
