import { v7 as uuidv7, validate, version } from 'uuid';

/**
 * A new primary key: a time-ordered UUID v7 (spec 10.1). Devices call this for the records they
 * create, so a retried upload carries the same ID and stays idempotent.
 */
export function newId(): string {
  return uuidv7();
}

/** True when the value is a UUID v7. */
export function isId(value: string): boolean {
  return validate(value) && version(value) === 7;
}
