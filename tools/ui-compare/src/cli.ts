// `pnpm --filter @thelamp/ui-compare compare --phone <number>`: screenshots each prototype artboard
// beside the portal page that answers to it (src/pages.ts), in Light and Dark at 1440 and 390 px,
// and writes a gallery page beside them. The portal, the API and Mailpit must be running
// (`pnpm dev` with OTP_PROVIDER=mailpit); the number signs in on the web as a demo person.
//
//   --phone      the number to sign in with, required for portal pairs unless --prototype-only
//   --console    default http://127.0.0.1:5174; console pairs sign in as vendor staff made for the
//                run with `pnpm invite-staff` (src/staff.ts), so the API's directory must be local
//   --app        default http://localhost:8081, the field app in a browser (`pnpm --filter
//                @thelamp/mobile web`); its pairs (`app-*`) sign in with --app-phone, a fresh
//                person from `pnpm --filter @thelamp/api e2e:fixtures`, never a seeded one
//   --only       keys from src/pages.ts, comma-separated
//   --portal     default http://127.0.0.1:5173
//   --mailpit    default http://localhost:8025
//   --out        default tools/ui-compare/out/<date and time>
//   --prototype-only  skip the portal
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { PAIRS, type Pair } from './pages.ts';
import { gallery, type Shot } from './gallery.ts';
import { freshCode, makeStaff } from './staff.ts';

const here = fileURLToPath(new URL('..', import.meta.url));
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const MARK = fileURLToPath(
  new URL('../../../packages/design-tokens/assets/Logos/mark.webp', import.meta.url),
);

const { values } = parseArgs({
  options: {
    phone: { type: 'string' },
    only: { type: 'string' },
    portal: { type: 'string', default: 'http://127.0.0.1:5173' },
    console: { type: 'string', default: 'http://127.0.0.1:5174' },
    app: { type: 'string', default: 'http://localhost:8081' },
    'app-phone': { type: 'string' },
    mailpit: { type: 'string', default: 'http://localhost:8025' },
    out: { type: 'string' },
    'prototype-only': { type: 'boolean', default: false },
  },
});
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const out = values.out ?? join(here, 'out', stamp);
mkdirSync(out, { recursive: true });
const wanted = values.only ? new Set(values.only.split(',')) : null;
const pairs = PAIRS.filter((pair) => !wanted || wanted.has(pair.key));
if (!values.phone && !values['prototype-only'] && pairs.some((pair) => !pair.app)) {
  throw new Error('Give --phone, the number a demo person signs in with, or --prototype-only.');
}
if (!values['app-phone'] && !values['prototype-only'] && pairs.some((p) => p.app === 'phone')) {
  throw new Error("Give --app-phone, a fresh e2e:fixtures person, for the field app's pairs.");
}

const THEMES = ['light', 'dark'] as const;
const WIDTHS = [1440, 390] as const;
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ts': 'text/javascript',
};

const RENDER_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="/prototype/ds/thelamp/tokens.css">
<link rel="stylesheet" href="/prototype/ds/thelamp/components/bundle.css">
</head><body style="margin:0"><div id="root"></div>
<script type="module">
import { renderDesign } from '/src/render.ts';
const query = new URLSearchParams(location.search);
const load = async (file) => {
  const response = await fetch('/prototype/' + file);
  if (!response.ok) throw new Error('No prototype file ' + file);
  return response.text();
};
const { nodes, helmet } = await renderDesign(query.get('file'), { theme: query.get('theme') }, load);
document.head.insertAdjacentHTML('beforeend', helmet.join(''));
document.getElementById('root').append(...nodes);
await document.fonts.ready;
window.rendered = true;
</script></body></html>`;

/** Serves the prototype and the renderer (its types stripped) to the browser, from this folder. */
function serve(): Promise<string> {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname));
    if (path === '/render.html') {
      response.writeHead(200, { 'content-type': 'text/html' }).end(RENDER_PAGE);
      return;
    }
    // The prototype's one image is the mark, kept in claude.ai's blob store; the repository has it.
    if (path.startsWith('/_blob/')) {
      response.writeHead(200, { 'content-type': 'image/webp' }).end(readFileSync(MARK));
      return;
    }
    const file = join(here, path);
    if (relative(here, file).startsWith('..') || !/^\/(prototype|src)\//.test(path)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const text = readFileSync(file, 'utf8');
      const body = extname(file) === '.ts' ? stripTypeScriptTypes(text) : text;
      response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }),
  );
}

/** The newest code Mailpit holds for the number, once it is newer than `after`. */
async function codeFor(digits: string, after: string | null): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(
      `${values.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${digits}@otp.local`)}&limit=1`,
    );
    const found = (await response.json()) as { messages: { ID: string; Subject: string }[] };
    const message = found.messages[0];
    const code = message?.Subject.match(/\d{6}/)?.[0];
    if (message && message.ID !== after && code) return code;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('No sign-in code reached Mailpit.');
}

async function latestId(digits: string): Promise<string | null> {
  const response = await fetch(
    `${values.mailpit}/api/v1/search?query=${encodeURIComponent(`to:${digits}@otp.local`)}&limit=1`,
  );
  return ((await response.json()) as { messages: { ID: string }[] }).messages[0]?.ID ?? null;
}

const browser = await chromium.launch();
const shots: Shot[] = [];

async function shoot(page: Page, name: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, name), fullPage: true, type: 'jpeg', quality: 72 });
  return name;
}

try {
  const base = await serve();
  const proto = await browser.newPage();
  for (const pair of pairs) {
    for (const theme of THEMES) {
      await proto.setViewportSize({ width: 1440, height: 900 });
      await proto.goto(`${base}/render.html?file=${pair.prototype}&theme=${theme}`);
      await proto.waitForFunction(
        () => (window as unknown as { rendered?: boolean }).rendered === true,
      );
      for (const width of pair.app === 'phone' ? [390] : WIDTHS) {
        await proto.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        const file = await shoot(proto, `${pair.key}.prototype.${theme}.${width}.jpg`);
        shots.push({ key: pair.key, side: 'prototype', theme, width, file });
      }
    }
  }

  const consolePairs = pairs.filter((pair) => pair.app === 'console');
  if (!values['prototype-only'] && consolePairs.length > 0) {
    const staff = await makeStaff(repo, values.console!);
    const confirmed = Math.floor(Date.now() / 30_000);
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${values.console}/sign-in`);
    await page.getByRole('textbox', { name: /^Email/ }).fill(staff.email);
    await page.getByLabel(/^Password/).fill(staff.password);
    await page
      .getByRole('textbox', { name: /^Authenticator code/ })
      .fill(await freshCode(staff.secret, confirmed));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${values.console}/`);
    for (const theme of THEMES) {
      await page.evaluate((value: string) => localStorage.setItem('theme', value), theme);
      for (const pair of consolePairs) await shootPortal(page, pair, theme, values.console!);
    }
  }

  const appPairs = pairs.filter((pair) => pair.app === 'phone');
  if (!values['prototype-only'] && appPairs.length > 0) {
    // The app follows the browser's scheme, so one sign-in serves both themes, as on the portal.
    const page = await (
      await browser.newContext({ viewport: { width: 390, height: 844 } })
    ).newPage();
    const scheme = (theme: 'light' | 'dark') => page.emulateMedia({ colorScheme: theme });
    await page.goto(values.app!);
    const number = page.getByLabel(/^Mobile number/);
    await number.waitFor({ timeout: 60_000 });
    for (const theme of THEMES) {
      await scheme(theme);
      for (const pair of appPairs.filter((candidate) => candidate.signedOut)) {
        await shootApp(page, pair, theme);
      }
    }
    const digits = values['app-phone']!.replace(/\D/g, '').slice(-10);
    const before = await latestId(digits);
    await number.fill(digits);
    await page.getByRole('button', { name: 'Send code' }).click();
    await page.getByLabel(/^Code sent by SMS/).fill(await codeFor(digits, before));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText(/^Good (morning|afternoon|evening)/).waitFor({ timeout: 30_000 });
    for (const theme of THEMES) {
      await scheme(theme);
      for (const pair of appPairs.filter((candidate) => !candidate.signedOut)) {
        await page.goto(`${values.app}${pair.portal}`);
        await page.getByText(/^Good (morning|afternoon|evening)/).waitFor({ timeout: 30_000 });
        await shootApp(page, pair, theme);
      }
    }
  }

  const portalPairs = pairs.filter((pair) => !pair.app);
  if (!values['prototype-only'] && portalPairs.length > 0) {
    const digits = values.phone!.replace(/\D/g, '').slice(-10);
    // The theme lives in the browser's storage, so one sign-in serves both themes: a number may
    // ask for 3 codes in 10 minutes (spec M1).
    const setTheme = (page: Page, theme: string) =>
      page.evaluate((value: string) => localStorage.setItem('theme', value), theme);
    const outside = await (await browser.newContext()).newPage();
    await outside.goto(`${values.portal}/sign-in`);
    for (const theme of THEMES) {
      await setTheme(outside, theme);
      for (const pair of portalPairs.filter((candidate) => candidate.signedOut)) {
        await shootPortal(outside, pair, theme);
      }
    }
    const inside = portalPairs.filter((pair) => !pair.signedOut);
    if (inside.length > 0) {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${values.portal}/sign-in`);
      const before = await latestId(digits);
      await page.getByRole('textbox', { name: /Mobile number/ }).fill(digits);
      await page.getByRole('button', { name: 'Send code' }).click();
      await page.getByRole('textbox', { name: 'Code' }).fill(await codeFor(digits, before));
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL(`${values.portal}/`);
      for (const theme of THEMES) {
        await setTheme(page, theme);
        for (const pair of inside) await shootPortal(page, pair, theme);
      }
    }
  }
} finally {
  await browser.close();
}

async function shootPortal(page: Page, pair: Pair, theme: string, base = values.portal!) {
  if (!pair.portal) return;
  await page.setViewportSize({ width: 1440, height: 900 });
  if (typeof pair.portal === 'string') {
    await page.goto(`${base}${pair.portal}`);
  } else {
    await page.goto(`${base}${pair.portal.list}`);
    const link = page.locator('main table tbody a[href]').nth(pair.portal.nth ?? 0);
    const href = await link.getAttribute('href', { timeout: 15_000 });
    await page.goto(`${base}${href}${pair.portal.suffix ?? ''}`);
  }
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const file = await shoot(page, `${pair.key}.portal.${theme}.${width}.jpg`);
    shots.push({ key: pair.key, side: 'portal', theme, width, file });
  }
}

/** The field app at 390 px; its screen scrolls inside the page, so the shot is the viewport. */
async function shootApp(page: Page, pair: Pair, theme: string) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  const file = `${pair.key}.portal.${theme}.390.jpg`;
  await page.screenshot({ path: join(out, file), type: 'jpeg', quality: 72 });
  shots.push({ key: pair.key, side: 'portal', theme, width: 390, file });
}

writeFileSync(join(out, 'index.html'), gallery(pairs, shots, new Date()));
console.log(
  `Wrote ${shots.length} screenshots and the gallery to ${relative(process.cwd(), out)}/`,
);
