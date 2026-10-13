/**
 * Catalogue rules (spec 5.11) as pure functions: the server applies them, the apps preview.
 */

export const MEASURE_TYPES = ['kg', 'L'] as const;
export type MeasureType = (typeof MEASURE_TYPES)[number];

/** BR-16 compares a pack label's measure with the item's within this much. */
const MEASURE_TOLERANCE = 0.001;

const UNITS: Record<string, { type: MeasureType; factor: number }> = {
  kg: { type: 'kg', factor: 1 },
  kgs: { type: 'kg', factor: 1 },
  kilo: { type: 'kg', factor: 1 },
  g: { type: 'kg', factor: 0.001 },
  gm: { type: 'kg', factor: 0.001 },
  gms: { type: 'kg', factor: 0.001 },
  gram: { type: 'kg', factor: 0.001 },
  grams: { type: 'kg', factor: 0.001 },
  l: { type: 'L', factor: 1 },
  ltr: { type: 'L', factor: 1 },
  ltrs: { type: 'L', factor: 1 },
  litre: { type: 'L', factor: 1 },
  litres: { type: 'L', factor: 1 },
  liter: { type: 'L', factor: 1 },
  ml: { type: 'L', factor: 0.001 },
};

/**
 * The measure a pack label states, such as "500 ML" (0.5 L) or "1 KG", in kg or L; null when it
 * states none, such as "Box of 10".
 */
export function packMeasure(label: string): { type: MeasureType; amount: number } | null {
  const match = /(\d+(?:\.\d+)?)\s*([a-z]+)\b/i.exec(label.trim());
  if (!match) return null;
  const unit = UNITS[match[2]!.toLowerCase()];
  return unit ? { type: unit.type, amount: Number(match[1]) * unit.factor } : null;
}

/**
 * BR-16: when the pack label states a measure, the item's measure per base unit must equal it,
 * in the same kind, within 0.001. Null when they agree, or the problem.
 */
export function packMeasureIssue(
  label: string | null,
  measure: { type: MeasureType; perBaseUnit: number } | null,
): string | null {
  const stated = label ? packMeasure(label) : null;
  if (!stated || !measure) return null;
  if (stated.type !== measure.type) {
    return `The pack label says ${stated.type}, but the measure is in ${measure.type}`;
  }
  if (Math.abs(stated.amount - measure.perBaseUnit) > MEASURE_TOLERANCE) {
    return `The pack label says ${stated.amount} ${stated.type} a unit, but the measure is ${measure.perBaseUnit}`;
  }
  return null;
}

/**
 * A percentage cell as a `numeric(7,4)` string, read exactly, never through binary floating
 * point: `18` and `7.5` stay as they are. BR-17: when the mapping marks the column, a value of 1
 * or less is a fraction, so `0.18` reads as `18.0000` and `0.075` as `7.5000`. Null for anything
 * but a plain decimal, or one finer than four places.
 */
export function percentFromCell(text: string, fraction: boolean): string | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  let whole = BigInt(match[1]!);
  let part = match[2] ?? '';
  const atMostOne = whole === 0n || (whole === 1n && /^0*$/.test(part));
  if (fraction && atMostOne) {
    const shifted = part.padEnd(2, '0');
    whole = whole * 100n + BigInt(shifted.slice(0, 2));
    part = shifted.slice(2);
  }
  part = part.replace(/0+$/, '');
  if (part.length > 4) return null;
  return `${whole}.${part.padEnd(4, '0')}`;
}
