import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTokens, contrast, generateCss, generateTs, type Tokens } from './generate.ts';
import { TOKENS_CSS, TOKENS_JSON, TOKENS_TS } from './paths.ts';

const tokens = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;

describe('the design tokens', () => {
  it('have up-to-date generated files: run `pnpm tokens` after changing tokens.json', () => {
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(generateCss(tokens));
    expect(readFileSync(TOKENS_TS, 'utf8')).toBe(generateTs(tokens));
  });

  it('give every themed token a value in every theme, and keep every promised contrast', () => {
    expect(checkTokens(tokens)).toEqual([]);
  });

  it('catch a missing theme value and a pair under its floor', () => {
    const broken = structuredClone(tokens);
    const text = broken.color.tokens.find((token) => token.name === 'text')!;
    text.value = { light: '#bbbbbb', dark: (text.value as Record<string, string>).dark! };
    const problems = checkTokens(broken);
    expect(problems).toContain('text has no value in outdoor');
    expect(problems.some((problem) => problem.startsWith('text on surface in light is'))).toBe(
      true,
    );
  });

  it('measure contrast as WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
