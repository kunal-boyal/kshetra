# Set up roles and designations

| | |
|---|---|
| **Who** | Roles: Admin or Business head (`role.manage`); those with `user.manage` can see them. Designations: Admin or Business head (`designation.manage`); everyone can see them. |
| **Where** | Web portal › **Settings** › **People and access** › **Roles**, and › **Designations** |
| **Module** | Core |
| **Related** | [Add and look after people](people.md), [Switch modules on and off](modules.md), [Set up sign-in security and single sign-on](security-and-sso.md), [Define account types](account-types.md) |

A role decides what people may do and whose records they reach. A designation is a job title with a level; it gives no permissions itself, but its default role is what new people with it get. Set both up before you add people.

## Before you start

- Switch on the modules you use first ([Switch modules on and off](modules.md)), so you can see which permissions matter.
- Your template already made six roles and its designations. Look at them before adding new ones.

### The roles every template starts with

| Role | Whose records it reaches | In short |
|---|---|---|
| Admin | Everyone | Every permission. It can't be narrowed. |
| Business head | Everyone | Nearly everything, but not billing, API clients, webhooks, the ERP, confirming collections, Home layouts or statutory payroll |
| Manager | Their team | Field work, review, planning and targets, the team's maps and performance, approvals, approving new accounts, resetting phones |
| Field user | Their own | Field work on the phone; **Mobile app only** |
| Back office | Everyone | Orders and deliveries, finance, confirming collections, marking expenses paid, payroll inputs, reports, imports, stock |
| Viewer | Everyone | Read only: targets, team performance and leaderboards, accounts, orders, reports, stock |

## Steps

### Look at a role

1. Open **Settings** › **People and access** › **Roles**. The table lists each role's **Name**, **Key**, **Whose records it reaches** and how many permissions it holds, marked **Built in** for the template's roles and **Mobile app only** where it applies.

### Add a role

1. Select **Add a role**. The **New role** form opens.
2. **Key**: lowercase letters, digits and underscores, such as `area_manager`. It never changes.
3. **Name in English** and **Name in Hindi**.
4. **Whose records it reaches**: **Their own**, **Their team**, **Their territories**, **Their team and territories** or **Everyone**. Their team means everyone who reports to them, at any depth.
5. Tick **Mobile app only** if people with this role should sign in only on the app, never on the web.
6. Under **What people with it may do**, tick the permissions, grouped by area: **Field work**, **Review**, **Planning**, **Performance**, **Maps**, **People**, **Territories and accounts**, **Configuration**, **Catalogue and orders**, **Finance**, **Attendance, leave and expenses**, **Reports and data**, **Integrations and billing**. Each shows its name and its code, such as `user.manage`.
7. Select **Save**.

### Change a role

1. Select **Edit** on its row, change the names, reach, **Mobile app only** or permissions, and select **Save**.
2. People holding the role get the change at once on the web, and on phones at their next sync.
3. The Admin role opens with **This role always holds every permission, across the whole organisation. Only its name can change.** Its reach, **Mobile app only** and permissions show greyed out; change **Name in English** or **Name in Hindi** and select **Save**. Only the name is sent.

### Add or change a designation

1. Open **Settings** › **People and access** › **Designations**. The table lists them from the highest level down, with **Level**, **Default role**, and the marks **People with it can have reports** and **Ranked on leaderboards**.
2. Select **Add a designation** (or **Edit** on a row).
3. **Key** (new ones only): lowercase letters, digits and underscores. It never changes.
4. **Level**: 1 is the highest, up to 10.
5. **One person, in English**, **Several people, in English**, **One person, in Hindi**, **Several people, in Hindi**.
6. **Default role**: the role a new person with this designation gets, unless you choose another when adding them.
7. Tick **People with it can have reports** for managers' designations.
8. Tick **Ranked on leaderboards** for the designations whose people are ranked against each other.
9. Select **Save**.

## What the system checks

- Nobody gives access they don't hold. You can't save a role with a permission you lack, or reaching further than you do (`canGrant()`). Permissions of modules that are off don't count against you.
- You can't change the role you hold yourself. Ask another admin.
- The Admin role always holds every permission across the organisation; its permissions, reach and **Mobile app only** can't change, and the form doesn't let you. Its name can.
- A role whose permissions include `role.manage`, `user.manage`, `settings.manage`, `module.manage`, `billing.manage` or `erp.manage` makes its holders use an authenticator app on the web ([Set up sign-in security and single sign-on](security-and-sso.md)).
- Permissions of a module that is off do nothing while it is off, though they stay ticked.
- Two permissions nothing used, "Set people policies" and "Edit notification messages", were taken out in November 2026 (D137), and every role lost them. A role that held nothing else shows 0 permissions: tick what its people should do, or move them to another role.
- Keys are unique among roles, and among designations.
- A designation can't stop allowing reports while people with it have active reports. A person can report only to someone whose designation allows reports.
- Roles and designations can't be deleted. Stop using one by moving its people to another.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| You don't have access to this. | The role holds a permission or reach you don't have, or it is the role you hold. | Ask an admin who holds it, or another admin, to make the change. |
| Some details need fixing. Check the highlighted fields. | A field is wrong, such as a name left empty. | Correct the field and select **Save** again. |
| This changed somewhere else. Refresh and try again. | The key is already used; the **Key** box says **Already used by another role** or **Already used by another designation**. | Choose another key. |
| **People with this designation have reports** under the checkboxes | You cleared **People with it can have reports** while people report to someone with it. | Move their reports first ([Add and look after people](people.md)), then save again. |

## Waiting on the owner

- The templates' default role permissions (D26) await Kunal's confirmation, and may change before the pilot.
- Problems the server describes under a field come in English only, while the screens around them are translated (D42).
- The Hindi role and designation names await a native speaker's review.
