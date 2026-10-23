/**
 * A clock the demo content generator moves through the past (decision D70), so every record goes
 * through the app's own services and rules as if it were made on its day: the sync window, shift
 * lengths, review order. Imported before anything else, it replaces the global `Date`, whose
 * `now()` and argument-less constructor then read the simulated moment. Only this process sees it;
 * the database's own clock, and the worker's, stay real.
 */
const RealDate = Date;
let offset = 0;

class SimulatedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...(args as [string | number | Date]));
  }

  static override now(): number {
    return RealDate.now() + offset;
  }
}

globalThis.Date = SimulatedDate as DateConstructor;

const listeners: ((offset: number) => void)[] = [];

/**
 * Called with the clock's offset from real time whenever it moves, for what must keep real time,
 * such as request signatures, which storage refuses when they are more than minutes off.
 */
export function onTravel(listener: (offset: number) => void): void {
  listeners.push(listener);
}

/** Moves the clock to `moment` (milliseconds); it runs on from there. */
export function travelTo(moment: number): void {
  offset = moment - RealDate.now();
  for (const listener of listeners) listener(offset);
}

/** Back to the present. */
export function returnToNow(): void {
  offset = 0;
}

/** The real time, whatever the simulated clock says. */
export const realNow = (): number => RealDate.now();
