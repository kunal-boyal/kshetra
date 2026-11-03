// `pnpm invite-staff`: invites a vendor staff member to the platform console (decision D88), and
// prints their one-time setup link. The first platform admin comes this way; after that, admins
// invite others from the console. With `--reset` it starts an existing staff member's sign-in
// again, as when the last platform admin lost their authenticator and nobody is left to reset it
// in the console (decision D134). In AWS it runs as a one-off task of the cell's image.
import { parseArgs } from 'node:util';
import { EmailAddress, InviteStaffBody, newId } from '@thelamp/shared';
import { createCommandContext, report } from './context';
import { StaffService } from './modules/console/staff.service';

const USAGE = `Usage: pnpm invite-staff --email <email> --name <name>
                         [--role platform_admin|implementation|support|finance]
                         (platform_admin by default)
       pnpm invite-staff --email <email> --reset
                         removes that staff member's password and authenticator, ends their
                         sessions and prints a new setup link; it never invites anyone new`;

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    reset: { type: 'boolean', default: false },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

if (values.reset) {
  const email = EmailAddress.safeParse(values.email);
  // A reset names its person by email alone, so nothing else can be mistaken for an invitation.
  if (!email.success || values.name !== undefined || values.role !== undefined) {
    console.error(USAGE);
    process.exit(1);
  }
  const { app } = await createCommandContext();
  try {
    const staff = app.get(StaffService);
    const found = await staff.byEmail(email.data);
    if (!found) {
      console.error(`No staff member has the email ${email.data}. Nothing was changed.`);
      process.exitCode = 1;
    } else {
      const { setupUrl } = await staff.reset(null, found.id);
      console.log(
        `Reset ${found.name} (${found.role}). Send them this link, which works for 72 hours:`,
      );
      console.log(setupUrl);
    }
  } catch (error) {
    report(error);
  } finally {
    await app.close();
  }
} else {
  const parsed = InviteStaffBody.safeParse({
    id: newId(),
    email: values.email,
    name: values.name,
    role: values.role ?? 'platform_admin',
  });
  if (!parsed.success) {
    console.error(USAGE);
    for (const issue of parsed.error.issues)
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    process.exit(1);
  }

  const { app } = await createCommandContext();
  try {
    const { staff, setupUrl } = await app.get(StaffService).invite(parsed.data, null);
    console.log(
      `Invited ${staff.name} as ${staff.role}. Send them this link, which works for 72 hours:`,
    );
    console.log(setupUrl);
  } catch (error) {
    report(error);
  } finally {
    await app.close();
  }
}
