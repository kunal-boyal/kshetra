import type { GeoPoint } from '@thelamp/shared';
import type { Access } from '../platform/auth';
import type { TenantTx } from '../platform/database';
import type { Dice, Market } from './names';

export const MINUTE = 60_000;
export const DAY = 86_400_000;

export interface Person {
  id: string;
  name: string;
  access: Access;
}

export interface Place {
  id: string;
  name: string;
  type: string;
  location: GeoPoint;
  /** The account that supplies its orders, if any. */
  parentId?: string;
}

export interface FieldPerson extends Person {
  market: Market;
  home: GeoPoint;
  manager: Person;
  places: Place[];
}

/** What the parts of the demo generator share: the tenant, its clock, the dice and the services. */
export interface DemoKit {
  readonly dice: Dice;
  readonly tenantId: string;
  readonly timezone: string;
  tx<T>(work: (tx: TenantTx) => Promise<T>): Promise<T>;
  get<T>(type: abstract new (...args: never[]) => T): T;
  /** Midnight of a date on the tenant's clock, plus `minutes`, in milliseconds. */
  at(date: string, minutes: number): number;
  /** Logs the first failure of a kind and carries on. */
  once(key: string, error: unknown): void;
  /** A photo the person takes at a place, uploaded and confirmed; null when it failed. */
  photo(
    person: Person,
    where: { name: string; location: GeoPoint },
    label: string,
    kind: 'evidence' | 'receipt' | 'odometer',
    at: number,
  ): Promise<string | null>;
}

/** The date a number of days after another, as `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** 0 for Sunday to 6 for Saturday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
