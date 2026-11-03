# Keep extra details about people

| | |
|---|---|
| **Who** | Admin or Business head (`settings.manage`); everyone can see the list |
| **Where** | Web portal › **Settings** › **People and access** › **People fields** |
| **Module** | Core |
| **Related** | [Add and look after people](people.md), [Import records from a spreadsheet](imports.md), [Define account types](account-types.md) |

People fields are the details your organisation keeps about each person beyond the standard ones (code, name, mobile number, email, designation, role, manager, territories, joining and exit dates), such as a blood group or a vehicle number. Add them before you add or import people.

## Before you start

- Decide each field's key and type. A key keeps its type for good once it has been used.

## Steps

1. Open **Settings** › **People and access** › **People fields**. With no fields yet, the page says **No fields yet. Add one to keep more details about people.**
2. Select **Add a field**. A new card appears.
3. **Key**: lowercase letters, digits and underscores, such as `blood_group`.
4. **Type**: **Short text**, **Long text**, **Number**, **Amount**, **Date**, **One choice**, **Several choices** or **Yes or no**.
5. **Label in English** and **Label in Hindi**. A blank Hindi label shows the English one.
6. For **One choice** or **Several choices**, fill **Choices**: one per line, as `key | English | Hindi`.
7. Tick **Must be filled** if every person needs a value.
8. Use **Move up** and **Move down** to set the order the fields appear in.
9. Repeat for each field, then select **Save fields**. The page says **Saved.**

### Retire a field, or bring it back

1. Select **Remove** on its card, then **Save fields**. The field retires: it disappears from forms, and its values are kept.
2. Retired fields are listed under **Retired fields**. To use one again, select **Add a field** beside it, then **Save fields**.

## Where the fields appear

- On **Add a person** and **Edit**, under **More details** ([Add and look after people](people.md)).
- On each person's **Profile**.
- As columns you can map when importing people ([Import records from a spreadsheet](imports.md)).

## What the system checks

- Keys are unique, and a key keeps its type once used: the **Type** of a saved field is locked.
- A retired field comes back only with the same key and type.
- The list is saved as a whole; every change is in the audit log.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Some details need fixing. Check the highlighted fields. | A field is wrong; the list under the message names each one by its place, such as `fields[2].key`, with the problem. | Correct each field named and save again. |
| You can't change a field's **Type**. | The field has been used, so its type is locked. | Add a new field with a new key instead. |
| The fields are greyed out and there is no **Save fields**. | Your role lacks `settings.manage`. | Ask an admin. |

## Waiting on the owner

- Problems the server describes come in English only (D42).
