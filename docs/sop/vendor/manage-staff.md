# Manage staff

| | |
|---|---|
| **Who** | Platform admin (`platform.staff.manage`) |
| **Where** | Console › **Staff** (under **Operations**) |
| **Related** | [Sign in and look after your account](sign-in-and-your-account.md) |

Invite the vendor's staff to the console in the role their work needs, give a new setup link to someone who lost their password or authenticator, and disable someone who leaves. The very first platform admin comes from the command line.

## Before you start

- Decide the role. Give each person the narrowest one their work needs:

  | Role | What it may do |
  |---|---|
  | Platform admin | Everything, including inviting and disabling staff |
  | Implementation | Creates, suspends and reactivates tenants |
  | Support | Sees tenants and asks for support access |
  | Finance | Plans, invoices and payments |

  These are the lines **Role** shows under the field. Implementation also terminates tenants and writes announcements; Support also resets a tenant user's lost authenticator; only a platform admin approves another's emergency support access.
- Their work email. Each email belongs to one staff member: inviting an email that is Invited or Disabled invites that same person again (below); an Active one is refused.

## Invite someone

1. Open **Staff**. The table lists everyone with **Name**, **Email**, **Role**, **Status** (Invited, Active or Disabled) and **Last sign-in**.
2. Under **Invite someone**, enter **Name** and **Email**, and choose **Role**.
3. Select **Invite**. A card appears: **Setup link for {name}**.
4. Select **Copy the link** (it changes to **Copied**) and send the link to the person yourself, by a channel you trust. It is shown only now, and works for 72 hours. Nothing is emailed.
5. They follow [Sign in and look after your account](sign-in-and-your-account.md). Their status turns from Invited to Active once they finish.

If the link expires before they finish, invite them again with the same email: their row is invited afresh with the name and role you give, and a new link replaces the old one. **Reset sign-in** in their row does the same without changing the name or role.

## Reset a lost password or authenticator

1. Confirm who is asking, by a channel other than the one they asked on.
2. On **Staff**, find them and select **Reset sign-in** in **Actions**.
3. The console asks "Reset {name}’s sign-in?" and explains that their password and authenticator are removed and their sessions end. Select **Reset sign-in** again, or **Cancel**.
4. A new **Setup link for {name}** card appears. Copy it and send it to them as when inviting. Their status is Invited again until they finish.

## Disable someone

1. On **Staff**, select **Disable** in their row.
2. The console asks "Disable {name}?" and explains that they are signed out at once and can't sign in again, and that inviting them afresh, with the same email, sends a new setup link. Select **Disable** again, or **Cancel**.

Their row stays, with its history in the platform audit. To bring them back, invite them again with the same email under **Invite someone**: the same row is invited afresh, with no password or authenticator, the name and role you give and a new setup link. The platform audit records it as an invitation made again, with the status and role before.

## The first platform admin

The console can't invite its first admin. Whoever runs the environment does it once from the command line, and sends the printed link to the admin:

- Locally: `pnpm invite-staff --email <work-email> --name "<name>"`. The role is Platform admin unless `--role implementation|support|finance` says otherwise.
- In AWS: a one-off task of the cell's image running `node dist/invite-staff.mjs --email … --name …`, as [docs/runbooks/deploy.md](../../runbooks/deploy.md) sets out.

It prints the link, which works for 72 hours. From then on, platform admins invite everyone else in the console. Keep at least two platform admins, so one can reset the other.

## Reset the last platform admin

Nobody resets themselves in the console, so a lone platform admin who loses their authenticator or password is reset from the command line, by whoever runs the environment:

1. Confirm who is asking, by a channel other than the one they asked on.
2. Run, locally, `pnpm invite-staff --email <their-email> --reset`; in AWS, a one-off task of the cell's image running `node dist/invite-staff.mjs --email … --reset`, as for the first admin.
3. It removes their password and authenticator, ends their sessions and prints a new setup link that works for 72 hours. Send it to them; they set up again as when invited.

The reset names its person by email alone: it refuses an email no staff member has, and changes nothing; it never invites anyone new, and it refuses `--name` or `--role` beside `--reset`. A disabled account isn't reset; invite it again instead. The platform audit records the reset as made from the command line.

## What the system checks

- Nobody resets or disables themselves: your own row shows no actions.
- A disabled account can't be reset; invite them again instead, on the same row.
- Each email has one row. Inviting an Invited or Disabled email invites that person again; an Active one is refused.
- Every invitation, setup, sign-in, reset and disabling is recorded in the platform audit, with who did it.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Someone already has this email. (under **Email**: "Already used by another staff member") | An Active staff member has this email | Use **Reset sign-in** in their row if they lost their sign-in |
| This account is disabled. Invite them again instead. | On **Reset sign-in**: the account was disabled meanwhile | Invite them again under **Invite someone** |
| You don't have access to this. | Your role isn't Platform admin | Ask a platform admin |
| They say the link has expired | 72 hours passed, or a newer link replaced it | Invite them again, or **Reset sign-in** in their row, whether they are Invited or Active |

## Waiting on the owner

- A platform admin in staging and production can only be invited once the company's AWS accounts exist and the environment has its `console_domain`; the setup link is built from the console's address.
