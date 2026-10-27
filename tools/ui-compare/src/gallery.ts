import type { Pair } from './pages.ts';

export interface Shot {
  key: string;
  side: 'prototype' | 'portal';
  theme: string;
  width: number;
  file: string;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The gallery: each pair's prototype beside the built page, switched between Light and Dark and
 * between desktop and phone widths. A page fragment, as the artifact viewer wraps it; it opens as
 * it is in a browser too.
 */
export function gallery(pairs: readonly Pair[], shots: readonly Shot[], at: Date): string {
  const find = (key: string, side: Shot['side'], theme: string, width: number) =>
    shots.find((s) => s.key === key && s.side === side && s.theme === theme && s.width === width);
  const figure = (
    key: string,
    side: Shot['side'],
    theme: string,
    width: number,
    label: string,
    missing: string,
  ) => {
    const shot = find(key, side, theme, width);
    return `<figure><figcaption>${label}</figcaption>${
      shot
        ? `<img src="${escape(shot.file)}" alt="${escape(`${label}, ${theme}, ${width} px`)}" loading="lazy">`
        : `<p class="missing">${missing}</p>`
    }</figure>`;
  };
  const sections = pairs
    .map((pair) => {
      const views = ['light', 'dark']
        .flatMap((theme) =>
          [1440, 390].map(
            (width) => `<div class="pair" data-theme-view="${theme}" data-width-view="${width}">
${figure(pair.key, 'prototype', theme, width, 'Prototype', 'Not screenshot')}
${figure(pair.key, 'portal', theme, width, 'Built', pair.portal ? 'Not screenshot' : 'Not built yet: the stage adds this page')}
</div>`,
          ),
        )
        .join('\n');
      return `<section id="${pair.key}" aria-labelledby="h-${pair.key}">
<header><h2 id="h-${pair.key}">${escape(pair.title)}</h2><span class="stage">Stage ${pair.stage}</span></header>
${views}
</section>`;
    })
    .join('\n');
  const toc = pairs
    .map(
      (pair) =>
        `<li><a href="#${pair.key}">${escape(pair.title)}</a> <span>${pair.stage}</span></li>`,
    )
    .join('');
  return `<title>Prototype and Portal</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
:root { --bg: #f3f5f1; --surface: #ffffff; --text: #17221c; --muted: #4b574f; --border: #dde3da; --accent: #1e5a3a; --on-accent: #ffffff; --chip: #e4eee7; --chip-fg: #164a2f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0f1411; --surface: #161d18; --text: #e9efe9; --muted: #aab6ae; --border: #2b3630; --accent: #86c9a0; --on-accent: #0b1f13; --chip: #15271c; --chip-fg: #b5e0c6; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #0f1411; --surface: #161d18; --text: #e9efe9; --muted: #aab6ae; --border: #2b3630; --accent: #86c9a0; --on-accent: #0b1f13; --chip: #15271c; --chip-fg: #b5e0c6; color-scheme: dark; }
body { background: var(--bg); color: var(--text); font: 15px/1.5 "Mukta", system-ui, sans-serif; }
.wrap { max-width: 1600px; margin: 0 auto; padding-block: 24px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: flex; flex-direction: column; gap: 24px; }
h1 { font-size: 28px; line-height: 1.2; margin: 0; text-wrap: balance; }
.intro { color: var(--muted); margin: 4px 0 0; max-width: 70ch; }
.controls { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 2; background: var(--bg); padding-block: 8px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; border-bottom: 1px solid var(--border); }
.seg { display: inline-flex; border: 1px solid var(--border); border-radius: 999px; padding: 3px; background: var(--surface); }
.seg button { font: inherit; border: 0; background: transparent; color: var(--text); padding: 4px 14px; border-radius: 999px; cursor: pointer; min-height: 32px; }
.seg button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }
nav ul { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
nav a { color: var(--accent); }
nav span, .stage { font-size: 12px; font-weight: 600; letter-spacing: .02em; background: var(--chip); color: var(--chip-fg); border-radius: 999px; padding: 1px 8px; }
section { display: flex; flex-direction: column; gap: 12px; scroll-margin-top: 64px; }
section header { display: flex; align-items: center; gap: 10px; }
h2 { font-size: 20px; margin: 0; }
.pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
.pair[hidden] { display: none; }
.pair[data-width-view="390"] { grid-template-columns: repeat(2, minmax(0, 420px)); }
figure { margin: 0; min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
figcaption { font-size: 13px; font-weight: 600; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--border); text-transform: uppercase; letter-spacing: .06em; }
figure img { display: block; width: 100%; height: auto; max-height: 1400px; object-fit: cover; object-position: top; }
.missing { padding: 48px 16px; margin: 0; text-align: center; color: var(--muted); }
@media (max-width: 720px) { .pair, .pair[data-width-view="390"] { grid-template-columns: minmax(0, 1fr); } }
</style>
<div class="wrap">
<div>
<h1>Prototype beside the built portal</h1>
<p class="intro">Each screen of the approved prototype next to the portal page that answers to it, taken ${escape(
    at.toISOString().slice(0, 16).replace('T', ' '),
  )} UTC from the local demo organisation. The stage tag is the phase U stage that redoes the page.</p>
</div>
<div class="controls">
<div class="seg" role="group" aria-label="Theme"><button type="button" data-theme-pick="light" aria-pressed="true">Light</button><button type="button" data-theme-pick="dark" aria-pressed="false">Dark</button></div>
<div class="seg" role="group" aria-label="Width"><button type="button" data-width-pick="1440" aria-pressed="true">Desktop 1440</button><button type="button" data-width-pick="390" aria-pressed="false">Phone 390</button></div>
</div>
<nav aria-label="Screens"><ul>${toc}</ul></nav>
${sections}
</div>
<script>
let theme = 'light', width = '1440';
function show() {
  document.querySelectorAll('.pair').forEach((el) => {
    el.hidden = el.dataset.themeView !== theme || el.dataset.widthView !== width;
  });
  document.querySelectorAll('[data-theme-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themePick === theme)));
  document.querySelectorAll('[data-width-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.widthPick === width)));
}
document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.themePick) theme = button.dataset.themePick;
  if (button.dataset.widthPick) width = button.dataset.widthPick;
  show();
});
show();
</script>
`;
}
