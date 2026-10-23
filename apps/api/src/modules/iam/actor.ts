import { AppError } from '@thelamp/shared';
import { type AuditActor, SYSTEM_ACTOR, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';

/** Changes made by the system itself, such as provisioning a tenant, which no user's access limits. */
export const SYSTEM = 'system' as const;

/** Who is making a change: a signed-in user, or the system. */
export type Actor = Access | typeof SYSTEM;

/** The user to record as `created_by` or `updated_by`; null for the system. */
export function actorId(actor: Actor): string | null {
  return actor === SYSTEM ? null : actor.userId;
}

/** The actor as the audit log records them. */
export function auditActor(actor: Actor): AuditActor {
  return actor === SYSTEM ? SYSTEM_ACTOR : userActor(actor);
}

/** A problem with one field of the request. */
export function invalid(path: string, issue: string): AppError {
  return new AppError('VALIDATION', 'Check the highlighted fields.', [{ path, issue }]);
}

export function notFound(): AppError {
  return new AppError('NOT_FOUND', 'This was not found.');
}

/** The record exists, but the caller's scope does not reach it (spec 4.2). */
export function outOfScope(): AppError {
  return new AppError('OUT_OF_SCOPE', 'This is outside the people and places you look after.');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An ID from the path. Anything that is not a UUID cannot name a record, so it is not found. */
export function pathId(value: string): string {
  if (!UUID.test(value)) throw notFound();
  return value.toLowerCase();
}

/** The name of the unique constraint a database error violated, if that is what it was. */
export function uniqueViolation(error: unknown): string | undefined {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === '23505' && 'constraint' in current) {
      return String(current.constraint);
    }
  }
  return undefined;
}
