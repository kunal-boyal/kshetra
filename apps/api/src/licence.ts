// `pnpm licence`: the vendor's licences for dedicated installs (spec M23, decision D90). It runs
// on the vendor's own machine and needs no database: `keys` makes the Ed25519 key pair once,
// `sign` writes a licence with the private key, and `check` reads one as an install would.
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BILLING_TIME_ZONE, licenceState, newId, todayIn } from '@thelamp/shared';
import {
  LicenceInvalid,
  LicenceTerms,
  licenceKeys,
  readLicence,
  signLicence,
} from './platform/licence';

const USAGE = `Usage:
  pnpm licence keys --out <folder>
      writes licence-private.pem (keep it secret, never in the repository) and licence-public.pem
  pnpm licence sign --key <licence-private.pem> --tenant-id <uuid> --slug <slug> --users <n>
                    --modules core,orders,... --expires <YYYY-MM-DD> --out <file>
  pnpm licence check --public-key <licence-public.pem> --file <licence file>`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    out: { type: 'string' },
    key: { type: 'string' },
    'public-key': { type: 'string' },
    file: { type: 'string' },
    'tenant-id': { type: 'string' },
    slug: { type: 'string' },
    users: { type: 'string' },
    modules: { type: 'string', default: 'core' },
    expires: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

switch (command) {
  case 'keys': {
    if (!values.out) fail('Name the folder for the keys with --out.');
    const privatePath = join(values.out, 'licence-private.pem');
    if (existsSync(privatePath)) fail(`${privatePath} exists already; keep using it.`);
    const { privateKey, publicKey } = licenceKeys();
    writeFileSync(privatePath, privateKey, { mode: 0o600 });
    chmodSync(privatePath, 0o600);
    writeFileSync(join(values.out, 'licence-public.pem'), publicKey);
    console.log(`Wrote ${privatePath} and licence-public.pem. Installs get the public key only.`);
    break;
  }
  case 'sign': {
    if (!values.key || !values.out)
      fail('Name the private key with --key and the file with --out.');
    const terms = LicenceTerms.safeParse({
      licenceId: newId(),
      tenantId: values['tenant-id'],
      tenantSlug: values.slug,
      users: Number(values.users),
      modules: values.modules.split(',').map((module) => module.trim()),
      issuedOn: todayIn(BILLING_TIME_ZONE, new Date()),
      expiresOn: values.expires,
    });
    if (!terms.success) {
      fail(
        terms.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n'),
      );
    }
    writeFileSync(values.out, signLicence(terms.data, readFileSync(values.key, 'utf8')));
    console.log(
      `Wrote licence ${terms.data.licenceId} for ${terms.data.tenantSlug}: ${terms.data.users} people, until ${terms.data.expiresOn}.`,
    );
    break;
  }
  case 'check': {
    if (!values['public-key'] || !values.file) fail('Name --public-key and --file.');
    let terms: LicenceTerms;
    try {
      terms = readLicence(
        readFileSync(values.file, 'utf8'),
        readFileSync(values['public-key'], 'utf8'),
      );
    } catch (error) {
      if (error instanceof LicenceInvalid) fail(error.message);
      throw error;
    }
    const { state, graceEndsOn } = licenceState(
      terms.expiresOn,
      todayIn(BILLING_TIME_ZONE, new Date()),
    );
    console.log(
      `${terms.tenantSlug}: ${terms.users} people, ${terms.modules.join(', ')}; expires ${terms.expiresOn} (${state}; grace to ${graceEndsOn}).`,
    );
    break;
  }
  default:
    fail(command ? `There is no ${command} command.` : 'Name a command.');
}
