import { describe, expect, it } from 'vitest';
import { Dice, flavourOf, sceneFor } from './names';

describe('sceneFor', () => {
  const dice = () => new Dice(7);

  it('takes an odometer from the dashboard folder, whatever its caption', () => {
    expect(sceneFor(flavourOf('agri'), 'Crop demo plot', 'odometer', dice())).toBe('odometer');
  });

  it("follows the template's words for a caption", () => {
    expect(sceneFor(flavourOf('agri'), 'Crop health check', 'form', dice())).toBe('field');
    expect(sceneFor(flavourOf('fmcg'), 'Planogram check', 'form', dice())).toBe('shelf');
    expect(sceneFor(flavourOf('pharma'), 'Chemist stock', 'form', dice())).toBe('shelf');
  });

  it('never asks a template without fields for one', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      expect(sceneFor(flavourOf('pharma'), 'Crop field', 'form', new Dice(seed))).not.toBe('field');
    }
  });

  it('falls back to a shop front or a shelf', () => {
    expect(['shop', 'shelf']).toContain(sceneFor(flavourOf('fmcg'), 'Visit', 'form', dice()));
  });
});
