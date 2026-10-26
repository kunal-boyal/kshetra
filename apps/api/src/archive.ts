// `pnpm archive`: tenant data archives (module M21, decision D95). It needs no database:
// `verify` checks an archive against the public key that signed it, as a customer would, and
// `public-key` prints the key a cell signs with, from its ARCHIVE_SIGNING_KEY, to publish.
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  ArchiveInvalid,
  archivePrivateKey,
  publicKeyId,
  verifyArchive,
} from './platform/archive-signer';

const USAGE = `Usage:
  pnpm archive verify --file <archive.zip> --public-key <public.pem>
  ARCHIVE_SIGNING_KEY=... pnpm archive public-key`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { file: { type: 'string' }, 'public-key': { type: 'string' } },
});

function fail(message: string): never {
  console.error(message);
  console.error(USAGE);
  process.exit(1);
}

switch (command) {
  case 'verify': {
    if (!values.file || !values['public-key']) fail('Name --file and --public-key.');
    try {
      const manifest = verifyArchive(
        readFileSync(values.file),
        readFileSync(values['public-key'], 'utf8'),
      );
      const rows = manifest.tables.reduce((sum, table) => sum + table.rows, 0);
      console.log(
        `Signed by key ${manifest.keyId} on ${manifest.createdAt}: ${manifest.tenant.name}, ${manifest.tables.length} tables, ${rows} rows, ${manifest.media.length} files. Every file matches.`,
      );
    } catch (error) {
      if (error instanceof ArchiveInvalid) fail(`Not valid: ${error.message}`);
      throw error;
    }
    break;
  }
  case 'public-key': {
    const seed = process.env.ARCHIVE_SIGNING_KEY;
    if (!seed || Buffer.from(seed, 'base64').length !== 32) {
      fail('Set ARCHIVE_SIGNING_KEY to the cell’s 32 bytes in base64.');
    }
    const publicKey = createPublicKey(archivePrivateKey(Buffer.from(seed, 'base64')));
    console.log(`Key ${publicKeyId(publicKey)}:`);
    process.stdout.write(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    break;
  }
  default:
    fail(command ? `There is no ${command} command.` : 'Name a command.');
}
