import { describe, expect, it } from 'vitest';
import {
  describeFormula,
  evaluateFormula,
  formulaFields,
  type FormulaNode,
  formulaValue,
  parseFormula,
} from './formula';

const tree = (text: string): FormulaNode => {
  const parsed = parseFormula(text);
  if ('problem' in parsed) throw new Error(`${parsed.problem.at}: ${parsed.problem.issue}`);
  return parsed.tree;
};
const run = (text: string, values: Record<string, unknown> = {}, places = 2) =>
  evaluateFormula(tree(text), values, places);
const problem = (text: string) => {
  const parsed = parseFormula(text);
  return 'problem' in parsed ? parsed.problem : null;
};

describe('reading formulas (decision D118)', () => {
  it('follows precedence, brackets and unary minus', () => {
    expect(run('2 + 3 * 4')).toBe('14.00');
    expect(run('(2 + 3) * 4')).toBe('20.00');
    expect(run('10 - 4 - 3')).toBe('3.00');
    expect(run('100 / 4 / 5')).toBe('5.00');
    expect(run('-2 * -3')).toBe('6.00');
    expect(run('2 × 3 ÷ 4 − 1')).toBe('0.50');
  });

  it('says where a formula goes wrong', () => {
    expect(problem('acres *')).toEqual({ at: 7, issue: 'The formula ends too soon' });
    expect(problem('(acres + 2')).toEqual({ at: 10, issue: 'Close the bracket' });
    expect(problem('acres $ 2')).toEqual({
      at: 6,
      issue: "`$` can't be used here",
    });
    expect(problem('acres 2')).toEqual({ at: 6, issue: 'Expected an operator or the end' });
    expect(problem('round(acres, 7)')).toEqual({ at: 13, issue: 'Round to 0 to 4 places' });
    expect(problem('min(acres)')).toEqual({ at: 0, issue: 'min needs at least two values' });
    expect(problem('if(acres, 1, 2)')).toEqual({
      at: 8,
      issue: 'Compare with <, <=, >, >=, = or !=',
    });
    expect(problem('max')).toEqual({ at: 0, issue: '`max` needs brackets, such as max(…)' });
    expect(problem('default(2, 0)')).toEqual({
      at: 8,
      issue: 'default takes a field first, such as default(bonus, 0)',
    });
    expect(problem('1.1234567')).toEqual({ at: 0, issue: 'Use at most 6 decimal places' });
  });

  it('refuses a formula too long or too large, without running out of stack', () => {
    expect(problem('1+'.repeat(260) + '1')?.issue).toBe('Use at most 500 characters');
    // Brackets nest at most 250 deep within the length, which the parser reads without trouble.
    expect(run('('.repeat(240) + '1' + ')'.repeat(240))).toBe('1.00');
    expect(problem(Array.from({ length: 120 }, () => 'a').join('+'))?.issue).toBe(
      'This formula is too long; split it over two fields',
    );
  });

  it('lists the fields it reads, once each', () => {
    expect(formulaFields(tree('acres * rate + default(bonus, 0) + acres'))).toEqual([
      'acres',
      'rate',
      'bonus',
    ]);
  });
});

describe('working formulas out exactly (decision D118)', () => {
  it('keeps money exact to the paisa, rounding half away from zero', () => {
    expect(run('qty * rate', { qty: 3, rate: '33.33' })).toBe('99.99');
    expect(run('100 / 3')).toBe('33.33');
    expect(run('200 / 3')).toBe('66.67');
    expect(run('0.1 + 0.2')).toBe('0.30');
    expect(run('0.005 * 1')).toBe('0.01');
    expect(run('-0.005 * 1')).toBe('-0.01');
    expect(run('1 / 3 * 3')).toBe('1.00');
    expect(run('round(2.5, 0) + round(-2.5, 0)', {}, 0)).toBe('0');
    expect(run('round(1 / 3, 2) * 3', {}, 4)).toBe('0.9900');
  });

  it('takes min, max, if and default', () => {
    expect(run('min(a, b, 7)', { a: 4, b: 9 })).toBe('4.00');
    expect(run('max(a, b, 7)', { a: 4, b: 9 })).toBe('9.00');
    expect(run('if(a >= 10, a * 2, a)', { a: 10 })).toBe('20.00');
    expect(run('if(a != 10, a * 2, a)', { a: 10 })).toBe('10.00');
    expect(run('a + default(bonus, 0)', { a: 5 })).toBe('5.00');
    expect(run('a + default(bonus, 0)', { a: 5, bonus: '2.50' })).toBe('7.50');
  });

  it('is blank while a field it reads is empty, and when it divides by zero', () => {
    expect(run('a + b', { a: 5 })).toBeNull();
    expect(run('a + b', { a: 5, b: '' })).toBeNull();
    expect(run('a / b', { a: 5, b: 0 })).toBeNull();
    // Only the branch taken is worked out.
    expect(run('if(b = 0, 0, a / b)', { a: 5, b: 0 })).toBe('0.00');
  });

  it('reads a product lines field as its total quantity', () => {
    expect(
      formulaValue([
        { itemId: 'x', quantity: 2.5 },
        { itemId: 'y', quantity: 0.125 },
      ]),
    ).toBe('2.625');
    expect(run('lines * 10', { lines: [{ itemId: 'x', quantity: 3 }] })).toBe('30.00');
    expect(formulaValue([])).toBeNull();
    expect(formulaValue('not a number')).toBeNull();
    expect(formulaValue(1e21)).toBe('1000000000000000000000');
  });
});

describe('the builder’s sentence (decision D118)', () => {
  const labels: Record<string, string> = { acres: 'Acres', rate: 'Rate per acre', bonus: 'Bonus' };
  const words = (phrase: string, parts: Record<string, string>) =>
    `${phrase}[${Object.values(parts).join('; ')}]`;
  const say = (text: string) => describeFormula(tree(text), (key) => labels[key] ?? key, words);

  it('names fields by their labels and keeps the grouping', () => {
    expect(say('acres * rate')).toBe('Acres × Rate per acre');
    expect(say('(acres + 2) * rate')).toBe('(Acres + 2) × Rate per acre');
    expect(say('acres - (rate - 1)')).toBe('Acres − (Rate per acre − 1)');
    expect(say('acres / (rate * 2)')).toBe('Acres ÷ (Rate per acre × 2)');
    expect(say('-(acres + 1)')).toBe('−(Acres + 1)');
  });

  it('puts functions in words', () => {
    expect(say('round(acres * rate, 2)')).toBe('round[Acres × Rate per acre; 2]');
    expect(say('if(acres > 10, rate, 0)')).toBe('if[Acres > 10; Rate per acre; 0]');
    expect(say('default(bonus, 0)')).toBe('default[Bonus; 0]');
  });
});
