# Build the territory tree

| | |
|---|---|
| **Who** | Admin or Business head (`territory.manage`) |
| **Where** | Web portal › **Settings** › **Field work** › **Territory levels**, and the rail's **Places** › **Territories** |
| **Module** | Core |
| **Related** | [Import records from a spreadsheet](imports.md), [Add and look after people](people.md), [Add accounts and approve proposals](accounts.md), [Set up roles and designations](roles-and-designations.md) |

Territories are the geography your people and accounts belong to, as a tree from the top level down, such as Zone, Region, Territory and Market in the agri template. First name the levels, then add the territories, by hand or from a spreadsheet. People whose role reaches **Their territories** see what lies in theirs.

## Before you start

- Your template already named the levels. Check them before adding territories.
- Give each territory a code. Imports find territories by code, so choose codes you will keep.

## Steps

### Name the levels

1. Open **Settings** › **Field work** › **Territory levels**. Each level is a card, **Level 1** at the top.
2. Change a level's **Name for one, in English**, **Name for many, in English** and the Hindi names as you need. A blank Hindi name shows the English one.
3. To add a level, select **Add a level at the bottom**, then fill its **Key** (lowercase letters, digits and underscores) and names. A new level can be taken away again with **Remove** until you save.
4. Select **Save levels**. The page says **Saved.**

### Add territories by hand

1. Open **Territories** in the rail, under **Places**.
2. Select **Add {level}**, which names your top level, such as Add Zone.
3. Fill **Name** and **Code**, then select **Save**. The page says, for example, **North is saved.**
4. To add a territory under it, select **Add {level}** on its row, which names the next level, such as Add Region. The form says the parent and the **Level**.
5. Repeat down the tree. The table shows each territory under its parent, a step further in.

To add many at once, select **Import from a spreadsheet** and import **Territories** ([Import records from a spreadsheet](imports.md)).

### Rename, recode or move a territory

1. Select **Edit** on its row.
2. Change **Name** or **Code**. Below the top level, choose another **Parent** to move it; the list offers only territories of the level above.
3. Select **Save**.

### Switch a territory off or on

1. Select **Switch off** on its row. It disappears from the table; tick **Show switched-off territories** to see it.
2. To bring it back, tick **Show switched-off territories**, then select **Switch on** on its row.

## What the system checks

- There are at most six levels. A level keeps its place and key once saved; new levels go only at the bottom.
- A territory keeps its level. It moves only under another switched-on territory of the level above.
- A code is unique in the organisation: up to 40 letters, digits, dots, dashes, slashes or underscores.
- A territory can't be switched off while territories under it are on, or while people work in it.
- A territory can't be switched on while the one above it is off.
- Switched-off territories aren't offered when adding people or accounts.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Territories under it are still on** | You tried to switch off a territory with switched-on children. | Switch its children off first, from the bottom up. |
| **People work in this territory** | People are still placed in it. | Transfer them to another territory first ([Add and look after people](people.md)). |
| **Switch the territory above it on first** | Its parent is off. | Switch the parent on, then this one. |
| **Another territory has this code** under **Code** | The code is taken. | Choose another code. |
| Some details need fixing. Check the highlighted fields. | On the levels page, a level's key or name is wrong; the list under the message names it, such as `levels[4].key`. | Correct it and select **Save levels** again. |

The bold messages above come from the server, in English.

## Waiting on the owner

- Problems the server describes come in English only (D42).
- The Hindi level names in the templates await a native speaker's review.
