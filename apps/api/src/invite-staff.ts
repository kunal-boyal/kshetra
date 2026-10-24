// `pnpm invite-staff`: invites a vendor staff member to the platform console (decision D88), and
// prints their one-time setup link. The first platform admin comes this way; after that, admins
// invite others from the console. In AWS it runs as a one-off task of the cell's image.
import { parseArgs } from 'node:util';
import { InviteStaffBody, newId } from '@thelamp/shared';
import { createCommandContext, report } from './context';
import { StaffService } from './modules/console/staff.service';

const USAGE = `Usage: pnpm invite-staff --email <email> --name <name>
                         [--role platform_admin|implementation|support|finance]
                         (platform_admin by default)`;

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'platform_admin' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
const parsed = InviteStaffBody.safeParse({
  id: newId(),
  email: values.email,
  name: values.name,
  role: values.role,
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
