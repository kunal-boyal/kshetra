// `pnpm tokens`: writes tokens.css and tokens.ts from tokens.json, after checking the tokens.
import { readFileSync, writeFileSync } from 'node:fs';
import { checkTokens, generateCss, generateTs, type Tokens } from './generate.ts';
import { TOKENS_CSS, TOKENS_JSON, TOKENS_TS } from './paths.ts';

const tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;
const problems = checkTokens(tokens);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
writeFileSync(TOKENS_CSS, generateCss(tokens));
writeFileSync(TOKENS_TS, generateTs(tokens));
console.log('Wrote tokens.css and tokens.ts.');
