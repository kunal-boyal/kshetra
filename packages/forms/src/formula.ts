/**
 * Calculated fields' formulas (decision D118): a small language over a form's number, currency and
 * quantity fields, parsed by hand and never handed to `eval`. Values are exact fractions of
 * `bigint`s, so an amount comes out to the paisa and the phone and the server agree to the digit.
 *
 * ```text
 * expr    := term (('+' | '-') term)*
 * term    := unary (('*' | '/') unary)*
 * unary   := '-' unary | primary
 * primary := number | field | call | '(' expr ')'
 * call    := round(expr, places) | min(expr, …) | max(expr, …)
 *          | if(expr cmp expr, expr, expr) | default(field, expr)
 * cmp     := '<' | '<=' | '>' | '>=' | '=' | '!='
 * ```
 */

/** A formula's longest text, and how many parts its tree may hold. */
export const FORMULA_LIMITS = { length: 500, nodes: 200, references: 20 } as const;

export const COMPARISONS = ['<', '<=', '>', '>=', '=', '!='] as const;
export type Comparison = (typeof COMPARISONS)[number];

export type FormulaNode =
  | { kind: 'number'; text: string }
  | { kind: 'field'; key: string }
  | { kind: 'negate'; value: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'round'; value: FormulaNode; places: number }
  | { kind: 'min' | 'max'; values: FormulaNode[] }
  | {
      kind: 'if';
      op: Comparison;
      left: FormulaNode;
      right: FormulaNode;
      then: FormulaNode;
      otherwise: FormulaNode;
    }
  | { kind: 'default'; key: string; fallback: FormulaNode };

/** Why a formula can't be read, and where: `at` counts characters from 0. */
export interface FormulaProblem {
  at: number;
  issue: string;
}

type Token =
  | { kind: 'number'; text: string; at: number }
  | { kind: 'name'; text: string; at: number }
  | { kind: 'symbol'; text: string; at: number }
  | { kind: 'end'; at: number };

const NAME = /[a-z][a-z0-9_]*/y;
const NUMBER = /\d+(?:\.\d+)?/y;
const SYMBOLS = ['<=', '>=', '!=', '<', '>', '=', '+', '-', '*', '/', '(', ')', ','];
/** What people type for times and divide, read as the plain symbols. */
const ALIASES: Record<string, string> = { '×': '*', '÷': '/', '−': '-' };

class Refused extends Error {
  constructor(
    readonly at: number,
    readonly issue: string,
  ) {
    super(issue);
  }
}

function tokens(text: string): Token[] {
  const found: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(text);
    if (number) {
      if ((number[0].split('.')[1]?.length ?? 0) > 6) {
        throw new Refused(at, 'Use at most 6 decimal places');
      }
      found.push({ kind: 'number', text: number[0], at });
      at += number[0].length;
      continue;
    }
    NAME.lastIndex = at;
    const name = NAME.exec(text);
    if (name) {
      found.push({ kind: 'name', text: name[0], at });
      at += name[0].length;
      continue;
    }
    const alias = ALIASES[char];
    if (alias) {
      found.push({ kind: 'symbol', text: alias, at });
      at += 1;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => text.startsWith(candidate, at));
    if (!symbol) throw new Refused(at, `\`${char}\` can't be used here`);
    found.push({ kind: 'symbol', text: symbol, at });
    at += symbol.length;
  }
  found.push({ kind: 'end', at });
  return found;
}

const FUNCTIONS = new Set(['round', 'min', 'max', 'if', 'default']);

/** Reads a formula into its tree, or says where it goes wrong. */
export function parseFormula(text: string): { tree: FormulaNode } | { problem: FormulaProblem } {
  if (text.length > FORMULA_LIMITS.length) {
    return {
      problem: {
        at: FORMULA_LIMITS.length,
        issue: `Use at most ${FORMULA_LIMITS.length} characters`,
      },
    };
  }
  try {
    const list = tokens(text);
    let index = 0;
    let nodes = 0;
    const peek = () => list[index]!;
    const next = () => list[index++]!;
    const node = <T extends FormulaNode>(made: T): T => {
      nodes += 1;
      if (nodes > FORMULA_LIMITS.nodes) {
        throw new Refused(peek().at, 'This formula is too long; split it over two fields');
      }
      return made;
    };
    const is = (symbol: string) => {
      const token = peek();
      return token.kind === 'symbol' && token.text === symbol;
    };
    const expect = (symbol: string, issue: string) => {
      if (!is(symbol)) throw new Refused(peek().at, issue);
      next();
    };
    const fieldKey = (issue: string): string => {
      const token = next();
      if (token.kind !== 'name' || FUNCTIONS.has(token.text)) throw new Refused(token.at, issue);
      return token.text;
    };
    // Depth is bounded by the node limit, as every level makes a node or consumes a token.
    const expr = (): FormulaNode => {
      let left = term();
      while (is('+') || is('-')) {
        const op = (next() as { text: string }).text as '+' | '-';
        left = node({ kind: 'binary', op, left, right: term() });
      }
      return left;
    };
    const term = (): FormulaNode => {
      let left = unary();
      while (is('*') || is('/')) {
        const op = (next() as { text: string }).text as '*' | '/';
        left = node({ kind: 'binary', op, left, right: unary() });
      }
      return left;
    };
    const unary = (): FormulaNode => {
      if (is('-')) {
        next();
        return node({ kind: 'negate', value: unary() });
      }
      return primary();
    };
    const primary = (): FormulaNode => {
      const token = next();
      if (token.kind === 'number') return node({ kind: 'number', text: token.text });
      if (token.kind === 'symbol' && token.text === '(') {
        const inner = expr();
        expect(')', 'Close the bracket');
        return inner;
      }
      if (token.kind === 'name') {
        if (is('(') && FUNCTIONS.has(token.text)) {
          next();
          return call(token.text, token.at);
        }
        if (FUNCTIONS.has(token.text)) {
          throw new Refused(token.at, `\`${token.text}\` needs brackets, such as ${token.text}(…)`);
        }
        return node({ kind: 'field', key: token.text });
      }
      throw new Refused(
        token.at,
        token.kind === 'end' ? 'The formula ends too soon' : 'Expected a number or a field',
      );
    };
    const call = (name: string, at: number): FormulaNode => {
      switch (name) {
        case 'round': {
          const value = expr();
          expect(',', 'round needs the number of places, such as round(x, 2)');
          const places = next();
          if (places.kind !== 'number' || !/^[0-4]$/.test(places.text)) {
            throw new Refused(places.at, 'Round to 0 to 4 places');
          }
          expect(')', 'Close the bracket');
          return node({ kind: 'round', value, places: Number(places.text) });
        }
        case 'min':
        case 'max': {
          const values = [expr()];
          while (is(',')) {
            next();
            values.push(expr());
          }
          expect(')', 'Close the bracket');
          if (values.length < 2) throw new Refused(at, `${name} needs at least two values`);
          return node({ kind: name, values });
        }
        case 'if': {
          const left = expr();
          const compare = next();
          if (
            compare.kind !== 'symbol' ||
            !(COMPARISONS as readonly string[]).includes(compare.text)
          ) {
            throw new Refused(compare.at, 'Compare with <, <=, >, >=, = or !=');
          }
          const right = expr();
          expect(',', 'if needs a value when true, such as if(a > b, a, b)');
          const then = expr();
          expect(',', 'if needs a value when false, such as if(a > b, a, b)');
          const otherwise = expr();
          expect(')', 'Close the bracket');
          return node({
            kind: 'if',
            op: compare.text as Comparison,
            left,
            right,
            then,
            otherwise,
          });
        }
        default: {
          const key = fieldKey('default takes a field first, such as default(bonus, 0)');
          expect(',', 'default needs a value for when the field is empty');
          const fallback = expr();
          expect(')', 'Close the bracket');
          return node({ kind: 'default', key, fallback });
        }
      }
    };
    const tree = expr();
    if (peek().kind !== 'end') throw new Refused(peek().at, 'Expected an operator or the end');
    return { tree };
  } catch (error) {
    if (error instanceof Refused) return { problem: { at: error.at, issue: error.issue } };
    throw error;
  }
}

/** Every field a formula reads, in order, once each. */
export function formulaFields(tree: FormulaNode): string[] {
  const found: string[] = [];
  const walk = (at: FormulaNode) => {
    switch (at.kind) {
      case 'number':
        return;
      case 'field':
        if (!found.includes(at.key)) found.push(at.key);
        return;
      case 'negate':
        return walk(at.value);
      case 'binary':
        walk(at.left);
        return walk(at.right);
      case 'round':
        return walk(at.value);
      case 'min':
      case 'max':
        return at.values.forEach(walk);
      case 'if':
        [at.left, at.right, at.then, at.otherwise].forEach(walk);
        return;
      case 'default':
        if (!found.includes(at.key)) found.push(at.key);
        return walk(at.fallback);
    }
  };
  walk(tree);
  return found;
}

/** An exact number: a fraction in lowest terms with a positive denominator. */
interface Fraction {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

const fraction = (n: bigint, d: bigint): Fraction => {
  const sign = d < 0n ? -1n : 1n;
  const common = gcd(n, d) || 1n;
  return { n: (sign * n) / common, d: (sign * d) / common };
};

/** A plain decimal such as `-12.5` as a fraction; null when it isn't one. */
function fromDecimal(text: string): Fraction | null {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const decimals = match[3] ?? '';
  const n = BigInt(`${match[2]}${decimals}`) * (match[1] ? -1n : 1n);
  return fraction(n, 10n ** BigInt(decimals.length));
}

/** A JavaScript number written out in full, never in exponent form. */
function numberText(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
}

/** Rounds half away from zero to some places, as amounts are rounded elsewhere. */
function rounded(value: Fraction, places: number): Fraction {
  const scale = 10n ** BigInt(places);
  const size = value.n < 0n ? -value.n : value.n;
  const whole = (size * scale * 2n + value.d) / (value.d * 2n);
  return fraction(value.n < 0n ? -whole : whole, scale);
}

/** A fraction as a decimal with exactly so many places, rounded half away from zero. */
function decimalText(value: Fraction, places: number): string {
  const kept = rounded(value, places);
  const scale = 10n ** BigInt(places);
  const scaled = (kept.n * scale) / kept.d;
  const negative = scaled < 0n;
  const digits = (negative ? -scaled : scaled).toString().padStart(places + 1, '0');
  const text = places === 0 ? digits : `${digits.slice(0, -places)}.${digits.slice(-places)}`;
  return negative && scaled !== 0n ? `-${text}` : text;
}

/**
 * What a field's value is to a formula: a number or an amount as itself, a product lines field as
 * its total quantity; null when it is empty or not a figure.
 */
export function formulaValue(value: unknown): string | null {
  if (typeof value === 'number') return numberText(value);
  if (typeof value === 'string') return fromDecimal(value) ? value.trim() : null;
  if (Array.isArray(value)) {
    let total = fraction(0n, 1n);
    for (const line of value) {
      const quantity = (line as { quantity?: unknown } | null)?.quantity;
      const text = typeof quantity === 'number' ? numberText(quantity) : null;
      const part = text === null ? null : fromDecimal(text);
      if (!part) return null;
      total = fraction(total.n * part.d + part.n * total.d, total.d * part.d);
    }
    return value.length === 0 ? null : decimalText(total, 3);
  }
  return null;
}

/**
 * Works a formula out over a form's values (decision D118): a decimal with `places` places,
 * rounded half away from zero, or null when a field it reads is empty (unless `default` gives a
 * value), or it divides by zero. `if` works out only the branch it takes.
 */
export function evaluateFormula(
  tree: FormulaNode,
  values: Readonly<Record<string, unknown>>,
  places: number,
): string | null {
  const read = (key: string): Fraction | null => {
    const text = formulaValue(values[key]);
    return text === null ? null : fromDecimal(text);
  };
  const compare = (a: Fraction, b: Fraction): number => {
    const left = a.n * b.d;
    const right = b.n * a.d;
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const work = (at: FormulaNode): Fraction | null => {
    switch (at.kind) {
      case 'number':
        return fromDecimal(at.text);
      case 'field':
        return read(at.key);
      case 'negate': {
        const value = work(at.value);
        return value && fraction(-value.n, value.d);
      }
      case 'binary': {
        const left = work(at.left);
        const right = work(at.right);
        if (!left || !right) return null;
        switch (at.op) {
          case '+':
            return fraction(left.n * right.d + right.n * left.d, left.d * right.d);
          case '-':
            return fraction(left.n * right.d - right.n * left.d, left.d * right.d);
          case '*':
            return fraction(left.n * right.n, left.d * right.d);
          case '/':
            return right.n === 0n ? null : fraction(left.n * right.d, left.d * right.n);
        }
        return null;
      }
      case 'round': {
        const value = work(at.value);
        return value && rounded(value, at.places);
      }
      case 'min':
      case 'max': {
        let best: Fraction | null = null;
        for (const part of at.values) {
          const value = work(part);
          if (!value) return null;
          const order = best ? compare(value, best) : 0;
          if (!best || (at.kind === 'min' ? order < 0 : order > 0)) best = value;
        }
        return best;
      }
      case 'if': {
        const left = work(at.left);
        const right = work(at.right);
        if (!left || !right) return null;
        const order = compare(left, right);
        const holds =
          at.op === '<'
            ? order < 0
            : at.op === '<='
              ? order <= 0
              : at.op === '>'
                ? order > 0
                : at.op === '>='
                  ? order >= 0
                  : at.op === '='
                    ? order === 0
                    : order !== 0;
        return work(holds ? at.then : at.otherwise);
      }
      case 'default':
        return read(at.key) ?? work(at.fallback);
    }
  };
  const result = work(tree);
  return result === null ? null : decimalText(result, places);
}

/** The words a formula's sentence is made of, in the reader's language. */
export type FormulaWords = (
  phrase: 'min' | 'max' | 'if' | 'round' | 'default',
  parts: Record<string, string>,
) => string;

const SIGNS: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const COMPARE_SIGNS: Record<Comparison, string> = {
  '<': '<',
  '<=': '≤',
  '>': '>',
  '>=': '≥',
  '=': '=',
  '!=': '≠',
};

/**
 * A formula as a sentence for the form builder (decision D118): fields by their labels, the
 * operators as × ÷ + −, and functions in words, such as "Acres × Rate per acre".
 */
export function describeFormula(
  tree: FormulaNode,
  label: (key: string) => string,
  words: FormulaWords,
): string {
  const strength = (at: FormulaNode) =>
    at.kind === 'binary' ? (at.op === '+' || at.op === '-' ? 1 : 2) : 3;
  const say = (at: FormulaNode): string => {
    switch (at.kind) {
      case 'number':
        return at.text;
      case 'field':
        return label(at.key);
      case 'negate':
        return `−${strength(at.value) < 3 ? `(${say(at.value)})` : say(at.value)}`;
      case 'binary': {
        const mine = strength(at);
        const left = strength(at.left) < mine ? `(${say(at.left)})` : say(at.left);
        // The right side binds as tightly as the operator for − and ÷, which don't regroup.
        const tight = at.op === '-' || at.op === '/';
        const right =
          strength(at.right) < mine || (tight && strength(at.right) === mine)
            ? `(${say(at.right)})`
            : say(at.right);
        return `${left} ${SIGNS[at.op]} ${right}`;
      }
      case 'round':
        return words('round', { value: say(at.value), places: String(at.places) });
      case 'min':
      case 'max':
        return words(at.kind, { values: at.values.map(say).join(', ') });
      case 'if':
        return words('if', {
          test: `${say(at.left)} ${COMPARE_SIGNS[at.op]} ${say(at.right)}`,
          then: say(at.then),
          otherwise: say(at.otherwise),
        });
      case 'default':
        return words('default', { field: label(at.key), fallback: say(at.fallback) });
    }
  };
  return say(tree);
}
