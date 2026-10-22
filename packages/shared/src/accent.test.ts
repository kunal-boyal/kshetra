import { describe, expect, it } from 'vitest';
import {
  ACCENT_THEMES,
  collidesWithStatus,
  deriveAccent,
  fromOklch,
  nearestPassingShade,
  toOklch,
} from './accent';
import { contrastRatio } from './colour';

const SURFACE = { light: '#ffffff', dark: '#1b1a18', outdoor: '#ffffff' } as const;
// Jamun, and brands across the wheel: a teal, a brick red, a mid blue and a green.
const BRANDS = ['#5b2b82', '#0f6e6e', '#a3321f', '#1f5fae', '#2e7d32'];

describe('OKLCH (decision D64)', () => {
  it('goes there and back', () => {
    for (const hex of BRANDS) expect(fromOklch(toOklch(hex))).toBe(hex);
  });
});

describe('the derived accent (tenant-theming.md)', () => {
  it('passes every pair in every theme, for brands across the wheel', () => {
    for (const brand of BRANDS) {
      const { palettes } = deriveAccent(brand);
      for (const theme of ACCENT_THEMES) {
        const p = palettes[theme];
        const floor = theme === 'outdoor' ? 7 : 4.5;
        expect(contrastRatio(p['on-accent'], p.accent), `${brand} ${theme}`).toBeGreaterThanOrEqual(
          floor,
        );
        expect(contrastRatio(p['on-accent'], p['accent-hover'])).toBeGreaterThanOrEqual(floor);
        expect(contrastRatio(p['accent-subtle-fg'], p['accent-subtle'])).toBeGreaterThanOrEqual(
          floor,
        );
        expect(contrastRatio(p['accent-subtle-fg'], p['accent-soft'])).toBeGreaterThanOrEqual(
          floor,
        );
        expect(contrastRatio(p.accent, SURFACE[theme])).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps the brand as entered in Light, and Jamun unchanged in Outdoor', () => {
    const { palettes, adjusted } = deriveAccent('#5B2B82');
    expect(palettes.light.accent).toBe('#5b2b82');
    expect(palettes.light['on-accent']).toBe('#ffffff');
    expect(palettes.outdoor.accent).toBe('#5b2b82');
    expect(adjusted.light).not.toContain('accent');
    // Dark: a light accent with dark text on it.
    expect(toOklch(palettes.dark.accent).l).toBeCloseTo(0.78, 1);
    expect(contrastRatio(palettes.dark['on-accent'], '#000000')).toBeLessThan(2);
  });
});

describe('a brand colour too light for white text', () => {
  it('offers the nearest darker shade of the same hue that passes', () => {
    const shade = nearestPassingShade('#4fb3e8');
    expect(contrastRatio(shade, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(toOklch(shade).h - toOklch('#4fb3e8').h)).toBeLessThan(5);
    expect(nearestPassingShade('#5b2b82')).toBe('#5b2b82');
  });
});

describe('the collision guard', () => {
  it('flags brand hues near a status hue', () => {
    expect(collidesWithStatus('#2e7d32')).toBe(true);
    expect(collidesWithStatus('#5b2b82')).toBe(false);
    expect(collidesWithStatus('#333333')).toBe(false);
  });
});
