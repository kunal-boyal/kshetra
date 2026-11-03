# Add accounts and approve proposals

| | |
|---|---|
| **Who** | Admin or Business head (`account.manage`) to add and change accounts; Admin, Business head or Manager (`account.approve`) to approve new accounts and locations proposed from phones |
| **Where** | Web portal › **Places** › **Accounts** (the tenant's word for accounts); **Daily work** › **Approvals** |
| **Module** | Core |
| **Related** | [Define account types](account-types.md), [Build the territory tree](territories.md), [Import records from a spreadsheet](imports.md), [Approval chains](approval-chains.md) |

Accounts are everyone your team sells to or meets: distributors, retailers and farmers in the agri template, doctors and chemists in pharma. Each account has a type, a territory, a location and the people who look after it. Admins add them here or by import; field users may propose new accounts and locations from their phones, which wait for approval.

## Before you start

- Account types and territories are set up ([Define account types](account-types.md), [Build the territory tree](territories.md)).
- The people who will look after the accounts are added ([Add and look after people](people.md)).
- For many accounts, use an import ([Import records from a spreadsheet](imports.md)).

## Steps

### Find accounts

1. Open **Accounts** in the rail, under **Places**. With more than one type, a tab per type shows each type's count.
2. Use **Search** (part of a name or code), **Status** (**Active**, **Waiting for approval**, **Switched off**) and, where the type has segments, **Segment**. Tick **Show on a map** to see them on a map.
3. The table shows each account's **Code**, **Name**, **Territory**, **Belongs to**, **Looked after by**, **Location** (**Verified** or **Not verified**), **Outstanding** and **Status**. **Needs {slots}** under a name lists required slots nobody fills.

### Add an account

1. On the type's tab, select **Add {type}**, which names the type, such as Add Retailer.
2. Fill **Name**, and **Code** unless the type numbers codes itself (then leave it blank).
3. Choose **Territory** and, where the type allows it, **Belongs to** (its parent account).
4. Under **Address**, fill **Street and area**, **City**, **State** and **PIN code**.
5. Under **Location**, fill **Latitude** and **Longitude** if you know them. Coordinates entered here count as verified. **Geofence radius (m)** is optional: blank uses the type's or the organisation's radius.
6. Under **Who looks after it**, choose a person for each slot. Slots marked with `*` must be filled; each offers only people of the designations the slot allows.
7. Fill **More details**, the type's own fields.
8. Select **Add**. The account's page opens.

### Change an account, or who looks after it

1. On the account's page, select **Edit**.
2. Change the details. To change who fills a slot, choose the new person, and set **Changes to these apply from** to today or a later day. Visits already made stay with the people who made them.
3. Select **Save**. The page's **Who looks after it** table keeps the history, **From** and **Until**.

### Switch an account off or on

1. On the account's page, select **Switch off**. The page says **Switched off.** Select **Switch on** to bring it back.

### Add contact people

For types that keep contact people:

1. On the account's page, under **Contact people**, select **Add a contact person**.
2. Fill **Name**, and if you like **Role**, **Mobile** and **Email**, then select **Add a contact person**.
3. Use **Switch off** on a contact's row when they leave.

### Approve new accounts proposed from phones

When a type's **Who adds them** is **Field users, with approval**, accounts added on phones arrive as **Waiting for approval**. The accounts list says, for example, **3 new Retailers were added from phones and wait for approval.**; **Review them** lists them.

1. Open **Approvals** in the rail, under **Daily work**. **Waiting for me** lists what you decide.
2. Choose the **New accounts** type above the list to see only those.
3. For one account, select **Approve**, or **Reject**, then fill **Why are you rejecting it?** (at least 3 characters; the person who asked sees it) and select **Reject** again.
4. For many, tick **Select all {count} that can be approved together**, or **Select** on each, then **Approve {count} selected**. The page says how many were approved and lists any that weren't, with why.

An approved account becomes **Active**; a rejected one becomes **Switched off**.

### Approve a proposed location

When a field user stands at an account without a verified location and proposes one, it arrives as **Account location** in **Approvals**.

1. Open the account to compare: **Proposed locations** lists each proposal's **Coordinates**, **Accuracy**, **Proposed by**, **Fix taken** and status.
2. In **Approvals**, **Approve** or **Reject** it as above. An approved location becomes the account's verified location.

## What the system checks

- A code is unique among accounts. A typed code is required unless the type numbers codes after its prefix.
- An account waiting for approval can't be switched on or off; it is decided in **Approvals**.
- A slot change applies from today or a later day, never earlier.
- Each slot takes only people of its allowed designations. **Needs {slots}** and the notice on the account's page show required slots left empty.
- The geofence radius is 50 to 5,000 metres.
- Approvals go to the proposer's manager, unless an approval chain says otherwise ([Approval chains](approval-chains.md)). Only the person whose turn it is can decide.
- Who sees an account (`AccountsService.reach()`): the people in its slots today, anyone whose role reaches those people, anyone whose role reaches its territory, and whoever proposed it. Fill the slots, or people won't see it.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Another account has this code** under **Code** | The code is taken. | Use another code. |
| **Decide it in the approvals inbox** | You tried to switch on an account still waiting for approval. | Approve it in **Approvals**. |
| **Choose today or a later day** under **Changes to these apply from** | The date is in the past. | Choose today or later. |
| It isn't your turn to act on this, or someone else already has. Refresh your inbox. | Someone else decided it, or it waits for another step. | Refresh **Approvals**. |
| No types set up yet | Your organisation has no active account types. | Add or switch on a type ([Define account types](account-types.md)). |
| This is outside the people and places you look after. | The account is outside your role's reach. | Ask someone whose role reaches it. |

The bold messages come from the server, in English.

## Waiting on the owner

- Problems the server describes come in English only (D42).
