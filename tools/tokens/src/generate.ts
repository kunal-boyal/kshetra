/**
 * Generates the design system's CSS and TypeScript from `tokens.json`, and checks the tokens
 * (packages/design-tokens/platforms.md, "Generating"). Plain Node runs this file, so it imports
 * nothing from the workspace.
 */

export type ThemeValue = string | Record<string, string>;

interface Token {
  name: string;
  value: ThemeValue;
  usage?: string;
}

interface TypeStyle {
  name: string;
  family?: string;
  fontSize: string;
  lineHeight: string;
  fontWeight: number;
  letterSpacing?: string;
}

export interface Tokens {
  name: string;
  version: number;
  color: { themes: { id: string }[]; tokens: Token[] };
  shadow?: { tokens: Token[] };
  type: {
    families: Record<string, string>;
    groups: { name: string; family: string; styles: TypeStyle[] }[];
  };
  [family: string]: unknown;
}

/** Families that are themed (one value per theme), or that are not plain lists of tokens. */
const SPECIAL = new Set(['name', 'version', 'meta', 'color', 'type', 'shadow']);
const CSS_FAMILY_NAMES: Record<string, string> = { zIndex: 'z-index', breakpoint: 'breakpoints' };

function plainFamilies(tokens: Tokens): string[] {
  return Object.keys(tokens).filter((key) => !SPECIAL.has(key));
}

function familyTokens(tokens: Tokens, family: string): Token[] {
  return (tokens[family] as { tokens: Token[] }).tokens;
}

function themes(tokens: Tokens): string[] {
  return tokens.color.themes.map((theme) => theme.id);
}

const REFERENCE = /^\{([A-Za-z0-9][A-Za-z0-9_.-]*)\}$/;

function cssValue(value: string): string {
  const reference = REFERENCE.exec(value);
  return reference ? `var(--${reference[1]})` : value;
}

function themed(token: Token, theme: string, fallback: string): string {
  const value = token.value;
  if (typeof value === 'string') return value;
  return value[theme] ?? value[fallback] ?? '';
}

/** `tokens.css`, in the layout the repository's copy has always had. */
export function generateCss(tokens: Tokens): string {
  const ids = themes(tokens);
  const first = ids[0]!;
  const perTheme = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];
  const plain = plainFamilies(tokens);
  const out: string[] = [
    `/* Generated from tokens.json. Do not edit by hand: change tokens.json and regenerate.
   Colours and shadows per theme (data-theme="light|dark|outdoor" on the root; light is the default),
   then ${plain.map((family) => CSS_FAMILY_NAMES[family] ?? family).join(', ')} and font stacks, then one class per type style. */
`,
  ];
  ids.forEach((theme, index) => {
    out.push(index === 0 ? `:root, [data-theme="${theme}"] {` : `\n[data-theme="${theme}"] {`);
    for (const token of perTheme) {
      out.push(`  --${token.name}: ${cssValue(themed(token, theme, first))};`);
    }
    out.push('}');
  });
  out.push('\n:root {');
  for (const family of plain) {
    for (const token of familyTokens(tokens, family)) {
      out.push(`  --${token.name}: ${token.value as string};`);
    }
  }
  for (const [key, stack] of Object.entries(tokens.type.families)) {
    out.push(`  --font-${key}: ${stack};`);
  }
  out.push('}\n');
  for (const group of tokens.type.groups) {
    for (const style of group.styles) {
      const declarations = [
        `font-family: var(--font-${style.family ?? group.family})`,
        `font-size: ${style.fontSize}`,
        `line-height: ${style.lineHeight}`,
        `font-weight: ${style.fontWeight}`,
      ];
      if (style.letterSpacing) declarations.push(`letter-spacing: ${style.letterSpacing}`);
      if (group.name === 'Numbers') declarations.push('font-variant-numeric: tabular-nums');
      out.push(`.${style.name} { ${declarations.join('; ')}; }`);
    }
  }
  return `${out.join('\n')}\n`;
}

const camel = (name: string) =>
  name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

/** `90ms` → 90, `16px` → 16, `0.48` → 0.48; anything else stays text. */
function jsValue(value: string): number | string | number[] {
  const unit = /^(-?\d+(?:\.\d+)?)(px|ms)?$/.exec(value);
  if (unit) return Number(unit[1]);
  const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(value);
  if (bezier) return bezier[1]!.split(',').map((part) => Number(part.trim()));
  return value;
}

/** Follows `{name}` references to the colour they stand for in one theme. */
function resolver(tokens: Tokens) {
  const all = new Map(
    [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])].map((token) => [token.name, token]),
  );
  const first = themes(tokens)[0]!;
  const resolve = (value: string, theme: string, depth = 0): string => {
    const reference = REFERENCE.exec(value);
    if (!reference || depth > 8) return value;
    const target = all.get(reference[1]!);
    return target ? resolve(themed(target, theme, first), theme, depth + 1) : value;
  };
  return resolve;
}

/**
 * `tokens.ts`, for code that can't read CSS variables, such as React Native and charts
 * (packages/design-tokens/platforms.md): colours and shadows per theme with references resolved,
 * sizes in pixels, durations in milliseconds and easings as cubic-bezier control points.
 */
export function generateTs(tokens: Tokens): string {
  const ids = themes(tokens);
  const first = ids[0]!;
  const resolve = resolver(tokens);
  const perTheme = (list: Token[]) =>
    Object.fromEntries(
      ids.map((theme) => [
        theme,
        Object.fromEntries(
          list.map((token) => [camel(token.name), resolve(themed(token, theme, first), theme)]),
        ),
      ]),
    );
  const exports: [string, unknown][] = [
    ['colors', perTheme(tokens.color.tokens)],
    ['shadows', perTheme(tokens.shadow?.tokens ?? [])],
  ];
  for (const family of plainFamilies(tokens)) {
    exports.push([
      family,
      Object.fromEntries(
        familyTokens(tokens, family).map((token) => [
          camel(token.name),
          jsValue(token.value as string),
        ]),
      ),
    ]);
  }
  exports.push(['fonts', tokens.type.families]);
  exports.push([
    'typeStyles',
    Object.fromEntries(
      tokens.type.groups.flatMap((group) =>
        group.styles.map((style) => [
          camel(style.name),
          {
            family: style.family ?? group.family,
            fontSize: jsValue(style.fontSize),
            lineHeight: jsValue(style.lineHeight),
            fontWeight: style.fontWeight,
            ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
            ...(group.name === 'Numbers' ? { tabularNumbers: true } : {}),
          },
        ]),
      ),
    ),
  ]);
  const body = exports
    .map(([name, value]) => `export const ${name} = ${JSON.stringify(value, null, 2)} as const;`)
    .join('\n\n');
  return `// Generated from tokens.json by tools/tokens. Do not edit by hand: change tokens.json and regenerate.

export const version = ${tokens.version};

export type ThemeName = ${ids.map((id) => `'${id}'`).join(' | ')};

${body}
`;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two hex colours. */
export function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = ['bg', 'surface', 'surface-sunken', 'surface-raised'];
const STATUSES = ['success', 'pending', 'waiting', 'info', 'danger', 'neutral'];
const PASTELS = ['sky', 'peach', 'mint', 'lilac', 'butter', 'rose', 'sage', 'sand'];

interface Pair {
  fg: string;
  bg: string;
  /** The floor in Light and Dark, then in Outdoor, which is read in direct sun. */
  floor: [number, number];
}

/** The colour pairs the usage notes promise, with their floors (WCAG AA and AAA). */
export const CONTRAST_PAIRS: readonly Pair[] = [
  ...SURFACES.flatMap((bg): Pair[] => [
    { fg: 'text', bg, floor: [7, 7] },
    { fg: 'text-muted', bg, floor: [4.5, 7] },
    { fg: 'text-subtle', bg, floor: [4.5, 7] },
  ]),
  { fg: 'text-inverse', bg: 'surface-inverse', floor: [4.5, 7] },
  { fg: 'border-strong', bg: 'surface', floor: [3, 7] },
  { fg: 'on-accent', bg: 'accent', floor: [4.5, 7] },
  { fg: 'on-accent', bg: 'accent-hover', floor: [4.5, 7] },
  { fg: 'accent-subtle-fg', bg: 'accent-subtle', floor: [4.5, 7] },
  { fg: 'accent-subtle-fg', bg: 'accent-soft', floor: [4.5, 7] },
  { fg: 'accent', bg: 'surface', floor: [3, 3] },
  { fg: 'focus-ring', bg: 'surface', floor: [3, 3] },
  { fg: 'on-danger', bg: 'danger-solid', floor: [4.5, 4.5] },
  ...STATUSES.flatMap((status): Pair[] => [
    { fg: `${status}-fg`, bg: `${status}-bg`, floor: [4.5, 7] },
    { fg: `${status}-fg`, bg: 'surface', floor: [4.5, 7] },
    { fg: `${status}-solid`, bg: 'surface', floor: [3, 4.5] },
  ]),
  ...PASTELS.flatMap((hue): Pair[] => [
    { fg: `pastel-${hue}-fg`, bg: `pastel-${hue}-bg`, floor: [4.5, 7] },
    { fg: `pastel-${hue}-fg`, bg: `pastel-${hue}-fill`, floor: [4.5, 7] },
  ]),
];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * What would make CI fail: a themed token without a value in every theme, a reference to a token
 * that doesn't exist, or a promised colour pair under its contrast floor.
 */
export function checkTokens(tokens: Tokens): string[] {
  const ids = themes(tokens);
  const resolve = resolver(tokens);
  const problems: string[] = [];
  const themedTokens = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];
  const names = new Set(themedTokens.map((token) => token.name));
  for (const token of themedTokens) {
    if (typeof token.value === 'string') continue;
    for (const theme of ids) {
      const value = token.value[theme];
      if (value === undefined) {
        problems.push(`${token.name} has no value in ${theme}`);
        continue;
      }
      const reference = REFERENCE.exec(value);
      if (reference && !names.has(reference[1]!)) {
        problems.push(`${token.name} refers to ${reference[1]}, which doesn't exist`);
      }
    }
  }
  const colors = new Map(tokens.color.tokens.map((token) => [token.name, token]));
  for (const pair of CONTRAST_PAIRS) {
    const fg = colors.get(pair.fg);
    const bg = colors.get(pair.bg);
    if (!fg || !bg) {
      problems.push(`The pair ${pair.fg} on ${pair.bg} names a token that doesn't exist`);
      continue;
    }
    for (const theme of ids) {
      const a = resolve(themed(fg, theme, ids[0]!), theme);
      const b = resolve(themed(bg, theme, ids[0]!), theme);
      if (!HEX.test(a) || !HEX.test(b)) continue;
      const floor = theme === 'outdoor' ? pair.floor[1] : pair.floor[0];
      const ratio = contrast(a, b);
      if (ratio < floor) {
        problems.push(
          `${pair.fg} on ${pair.bg} in ${theme} is ${ratio.toFixed(2)}:1, under its floor of ${floor}:1`,
        );
      }
    }
  }
  return problems;
}
