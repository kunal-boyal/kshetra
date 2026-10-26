// `pnpm tenant-move`: moving a tenant from one cell to another (module M21, spec 9.3, decision
// D95). Each step runs on the cell it names, with that cell's settings; docs/runbooks/tenant-moves.md
// walks through them in order.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createCommandContext, report } from './context';
import { TenantMoves } from './modules/governance/tenant-moves';

const USAGE = `Usage, in this order:
  pnpm tenant-move register-cell                      on the target: lists this cell in the directory
  pnpm tenant-move start --tenant <slug> --to <cell>  anywhere: freezes the tenant's writes
  pnpm tenant-move export --tenant <slug> --out <file.zip>
                                                      on the source: writes the signed move archive
  pnpm tenant-move import --file <file.zip> --public-key <source.pem>
                                                      on the target: imports it, checking every count
  pnpm tenant-move finish --tenant <slug>             on the target: sends the tenant's people here
  pnpm tenant-move purge --tenant <slug> --confirm <slug> [--files]
                                                      on the source: removes what it held; --files
                                                      also its files, if the cells don't share a bucket
  pnpm tenant-move cancel --tenant <slug>             anywhere, before finish: writes resume`;

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    tenant: { type: 'string' },
    to: { type: 'string' },
    out: { type: 'string' },
    file: { type: 'string' },
    'public-key': { type: 'string' },
    confirm: { type: 'string' },
    files: { type: 'boolean', default: false },
  },
});

function need(value: string | undefined, flag: string): string {
  if (!value) {
    console.error(`Name ${flag}.`);
    console.error(USAGE);
    process.exit(1);
  }
  return value;
}

const { app } = await createCommandContext();
const moves = app.get(TenantMoves);
try {
  switch (command) {
    case 'register-cell':
      console.log(`Cell ${await moves.registerCell()} is in the directory.`);
      break;
    case 'start': {
      const slug = need(values.tenant, '--tenant');
      await moves.start(await moves.tenantId(slug), need(values.to, '--to'));
      console.log(`${slug} is moving: it reads, and its writes wait until the move ends.`);
      break;
    }
    case 'export': {
      const slug = need(values.tenant, '--tenant');
      const facts = await moves.export(await moves.tenantId(slug), need(values.out, '--out'));
      console.log(
        `Wrote ${values.out}: ${facts.tables} tables, ${facts.rows} rows, ${facts.files} files, ${facts.bytes} bytes, signed by key ${facts.keyId}.`,
      );
      break;
    }
    case 'import': {
      const archive = readFileSync(need(values.file, '--file'));
      const publicKey = readFileSync(need(values['public-key'], '--public-key'), 'utf8');
      const done = await moves.import(archive, publicKey);
      console.log(
        `Imported ${done.tables} tables, ${done.rows} rows and ${done.files} files; every count matches. Finish the move next.`,
      );
      break;
    }
    case 'finish': {
      const slug = need(values.tenant, '--tenant');
      await moves.finish(await moves.tenantId(slug));
      console.log(`${slug} now lives on this cell, and writes again. Purge the old cell next.`);
      break;
    }
    case 'purge': {
      const slug = need(values.tenant, '--tenant');
      if (values.confirm !== slug) {
        console.error(`Repeat the slug with --confirm ${slug} to purge it from this cell.`);
        process.exit(1);
      }
      const removed = await moves.purge(await moves.tenantId(slug), { files: values.files });
      console.log(`Removed ${removed} rows of ${slug} from this cell.`);
      break;
    }
    case 'cancel': {
      const slug = need(values.tenant, '--tenant');
      await moves.cancel(await moves.tenantId(slug));
      console.log(`The move of ${slug} is called off; it writes again where it was.`);
      break;
    }
    default:
      console.error(command ? `There is no ${command} command.` : 'Name a command.');
      console.error(USAGE);
      process.exitCode = 1;
  }
} catch (error) {
  report(error);
} finally {
  await app.close();
}
