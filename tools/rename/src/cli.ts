// `pnpm rename --name "New Name" [--slug newname] [--scope newname] [--app-id com.newname.app]`:
// renames the product across the repository from product.json (decision D1). `--dry-run` only
// counts. Then run `pnpm install`, `pnpm tokens` and `pnpm openapi`, and do the steps it prints.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { followUps, plan, type Product, replacements, rewrite } from './rename.ts';

const root = new URL('../../../', import.meta.url);
const productFile = new URL('product.json', root);
const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    scope: { type: 'string' },
    'app-id': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const product = JSON.parse(readFileSync(productFile, 'utf8')) as Product;
const { next, problems } = plan(product, {
  ...(values.name === undefined ? {} : { name: values.name }),
  ...(values.slug === undefined ? {} : { slug: values.slug }),
  ...(values.scope === undefined ? {} : { scope: values.scope }),
  ...(values['app-id'] === undefined ? {} : { appId: values['app-id'] }),
});
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
const pairs = replacements(product, next);
if (pairs.length === 0) {
  console.log('Nothing to change.');
  process.exit(0);
}

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const files = git('ls-files', '-z')
  .split('\0')
  .filter((path) => path && !product.skip.includes(path));

let changed = 0;
for (const path of files) {
  const file = new URL(path, root);
  const bytes = readFileSync(file);
  // Images and other binary files keep their bytes.
  if (bytes.subarray(0, 8000).includes(0)) continue;
  const text = bytes.toString('utf8');
  const result = rewrite(text, pairs, product.keep);
  if (result === text) continue;
  changed++;
  if (!values['dry-run']) writeFileSync(file, result);
}

const moves = files
  .map((path) => [path, rewrite(path, pairs, product.keep)] as const)
  .filter(([path, moved]) => path !== moved);
if (!values['dry-run']) {
  for (const [path, moved] of moves) git('mv', path, moved);
  writeFileSync(productFile, `${JSON.stringify({ ...product, ...next }, null, 2)}\n`);
}

console.log(
  `${values['dry-run'] ? 'Would change' : 'Changed'} ${changed} files and ${moves.length} file names: ${pairs.map(([old, now]) => `${old} → ${now}`).join(', ')}.`,
);
console.log('Next: pnpm install, pnpm tokens, pnpm openapi, then the checks.');
for (const step of followUps(product, next)) console.log(`- ${step}`);
