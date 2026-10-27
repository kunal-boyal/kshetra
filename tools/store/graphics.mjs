// The store listings' graphics (decision D100), drawn from the brand's own parts: the mark
// (mark.webp), Mukta from @fontsource and the colours in tokens.json, rendered by the Chromium
// Playwright already installs for the portal's end-to-end tests.
//
//   node tools/store/graphics.mjs      writes docs/store/graphics/
//
// Play's icon is 512 px square; its feature graphic 1,024 x 500, one per listing language. The App
// Store's icon is the app's own 1,024 px icon, which EAS takes from apps/mobile/assets/icon.png.
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { chromium } = createRequire(`${root}apps/web/package.json`)('@playwright/test');
const out = `${root}docs/store/graphics/`;
mkdirSync(out, { recursive: true });

const tokens = JSON.parse(readFileSync(`${root}packages/design-tokens/tokens.json`, 'utf8'));
/** A colour token's Light value, wherever tokens.json keeps it. */
function colour(name) {
  const found = JSON.stringify(tokens).match(
    new RegExp(`"name":"${name}","value":\\{"light":"(#[0-9a-f]{6})"`),
  );
  if (!found) throw new Error(`No colour token ${name}.`);
  return found[1];
}
const forest = colour('brand-forest');
const gold = colour('brand-gold');
const onBrand = colour('on-brand');

const dataUrl = (path, type) =>
  `data:${type};base64,${readFileSync(`${root}${path}`).toString('base64')}`;
const mark = dataUrl('packages/design-tokens/assets/Logos/mark.webp', 'image/webp');
const fonts = 'node_modules/@fontsource/mukta/files';
const face = (script, weight) => `@font-face {
  font-family: Mukta; font-weight: ${weight};
  src: url(${dataUrl(`apps/web/${fonts}/mukta-${script}-${weight}-normal.woff2`, 'font/woff2')});
}`;
const fontFaces = ['latin', 'devanagari']
  .flatMap((script) => [500, 700].map((weight) => face(script, weight)))
  .join('\n');

const product = JSON.parse(readFileSync(`${root}product.json`, 'utf8')).name;
/** The sign-in page's tagline in each listing language, so the store says what the app says. */
const TAGLINES = {
  en: 'Field work, seen clearly.',
  hi: 'मैदान का हर काम, साफ़ नज़र आए।',
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  await page.setViewportSize({ width: 512, height: 512 });
  await page.setContent(
    `<body style="margin:0"><img src="${mark}" style="display:block;width:512px;height:512px"></body>`,
  );
  await page.screenshot({ path: `${out}play-icon-512.png` });

  await page.setViewportSize({ width: 1024, height: 500 });
  for (const [language, tagline] of Object.entries(TAGLINES)) {
    await page.setContent(`<html lang="${language}"><head><style>
      ${fontFaces}
      body { margin: 0; width: 1024px; height: 500px; background: ${forest}; color: ${onBrand};
        font-family: Mukta, sans-serif; display: flex; align-items: center; gap: 56px;
        padding: 0 88px; box-sizing: border-box; }
      img { width: 240px; height: 240px; border-radius: 48px; flex: none; }
      h1 { font-size: 88px; font-weight: 700; line-height: 1; margin: 0 0 20px; }
      p { font-size: 40px; font-weight: 500; line-height: 1.4; margin: 0; }
      i { display: block; width: 96px; height: 8px; background: ${gold}; margin-bottom: 28px; }
    </style></head><body><img src="${mark}" alt=""><div><i></i><h1>${product}</h1>
      <p>${tagline}</p></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${out}play-feature-graphic-${language}.png` });
  }
} finally {
  await browser.close();
}
console.log(`Wrote ${out}`);
