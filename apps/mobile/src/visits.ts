import {
  type EntryChanges,
  entryPhotos,
  type FormEntries,
  type FormEntry,
  type Outbox,
  type SqlDatabase,
  submissionBody,
  type Tracking,
  type Visits,
} from '@thelamp/api-client/sync';
import type { AccountType, FormDefinition } from '@thelamp/forms';
import {
  type CaptureFix,
  type CheckOutBody,
  type CreatePlanItemBody,
  distanceMeters,
  geofenceRadius,
  geofenceResult,
  type GeofenceResult,
  newId,
  type StartVisitBody,
  type SyncAccount,
  type TenantSettings,
} from '@thelamp/shared';
import type { Fix } from './location';

/**
 * Visits on the phone (M6): checking in and out, and sending what is filled, each saved on the
 * phone and queued in one transaction. The phone judges the geofence as the server will (BR-33),
 * from its copy of the account; the server judges again.
 */

interface Ready {
  db: SqlDatabase;
  outbox: Outbox;
  tracking: Tracking;
  visits: Visits;
  entries: FormEntries;
}

/** A fix as a record carries it. */
export const captureFix = (fix: Fix): CaptureFix => ({
  location: { lat: fix.lat, lng: fix.lng },
  accuracy: fix.accuracy,
  mocked: fix.mocked,
  capturedAt: fix.capturedAt,
});

export type GeofencePolicy = 'off' | 'advisory' | 'required';

export interface Geofence {
  result: GeofenceResult;
  /** Metres from the account's verified location; null without one. */
  distanceM: number | null;
  radiusM: number;
  policy: GeofencePolicy;
}

/**
 * The geofence a fix is judged by at an account (BR-33): its radius by the account, its type or
 * the tenant, the type's policy unless a form sets its own, and only a verified location counts.
 */
export function geofenceAt(
  account: Pick<SyncAccount, 'location' | 'locationStatus' | 'geofenceRadiusM'>,
  type: Pick<AccountType, 'location'> | undefined,
  settings: Pick<TenantSettings, 'geofenceRadiusMeters' | 'geofenceAccuracyCapMeters'>,
  fix: Pick<Fix, 'lat' | 'lng' | 'accuracy'>,
  form?: Pick<FormDefinition, 'geofence'>,
): Geofence {
  const distanceM =
    account.locationStatus === 'verified' && account.location
      ? distanceMeters(account.location, { lat: fix.lat, lng: fix.lng })
      : null;
  const radiusM = geofenceRadius(
    account.geofenceRadiusM,
    type?.location.geofenceRadiusM,
    settings.geofenceRadiusMeters,
  );
  const typePolicy = type?.location.geofencePolicy ?? 'advisory';
  const policy = form && form.geofence !== 'inherit' ? form.geofence : typePolicy;
  return {
    result: geofenceResult({
      distanceM,
      radiusM,
      accuracyM: fix.accuracy,
      accuracyCapM: settings.geofenceAccuracyCapMeters,
    }),
    distanceM: distanceM === null ? null : Math.round(distanceM),
    radiusM,
    policy,
  };
}

/** Thrown when something needs the person on duty and they aren't. */
export class NotOnShift extends Error {
  constructor() {
    super('Start the day first.');
    this.name = 'NotOnShift';
  }
}

/**
 * Check in at an account: the visit opens on the phone and its check-in is queued after the
 * punch-in. A visit still open is checked out by the server at this check-in. Returns its ID.
 */
export async function checkIn(
  sync: Ready,
  owner: string,
  input: { accountId: string; fix: Fix; planItemId?: string },
): Promise<string> {
  const shift = await sync.tracking.current(owner);
  if (!shift) throw new NotOnShift();
  const id = newId();
  const checkedInAt = Date.parse(input.fix.capturedAt);
  const body: StartVisitBody = {
    id,
    accountId: input.accountId,
    checkedInAt: input.fix.capturedAt,
    fix: captureFix(input.fix),
    // The planned visit it carries out (M8, BR-35).
    ...(input.planItemId ? { planItemId: input.planItemId } : {}),
  };
  await sync.db.transaction(async (tx) => {
    await sync.visits.open(tx, {
      owner,
      visitId: id,
      accountId: input.accountId,
      shiftId: shift.shiftId,
      checkedInAt,
    });
    await sync.outbox.enqueue(tx, {
      id,
      owner,
      kind: 'visit.check_in',
      payload: body,
      dependsOn: [shift.shiftId],
    });
  });
  return id;
}

/** Check out of the open visit, with a fix when the phone has one. */
export async function checkOut(sync: Ready, owner: string, fix: Fix | null): Promise<void> {
  const visit = await sync.visits.current(owner);
  if (!visit) return;
  const body: CheckOutBody & { visitId: string } = {
    visitId: visit.visitId,
    checkedOutAt: fix?.capturedAt ?? new Date().toISOString(),
    ...(fix ? { fix: captureFix(fix) } : {}),
  };
  await sync.db.transaction(async (tx) => {
    await sync.visits.close(tx, owner);
    await sync.outbox.enqueue(tx, {
      id: newId(),
      owner,
      kind: 'visit.check_out',
      payload: body,
      dependsOn: [visit.visitId],
    });
  });
}

/**
 * Submits a checked entry (M6): when and where it was captured, the visit it belongs to, and its
 * upload, queued after its photos and its visit's check-in, all in one transaction.
 */
export async function submitEntry(
  sync: Ready,
  owner: string,
  input: { id: string; changes: EntryChanges; fix: Fix; visitId: string | null },
): Promise<FormEntry> {
  const capturedAt = Date.parse(input.fix.capturedAt);
  return sync.entries.submit(
    owner,
    input.id,
    input.changes,
    { capturedAt, fix: captureFix(input.fix), visitId: input.visitId },
    async (tx, entry) => {
      await sync.outbox.enqueue(tx, {
        id: entry.id,
        owner,
        kind: 'submission.create',
        payload: submissionBody(entry),
        dependsOn: [...entryPhotos(entry), ...(input.visitId ? [input.visitId] : [])],
      });
      if (input.visitId) await sync.visits.touch(tx, owner, input.visitId, capturedAt);
    },
  );
}

/** A visit the person plans for themselves (M8), queued to send. Returns its ID. */
export async function planVisit(
  sync: Pick<Ready, 'db' | 'outbox'>,
  owner: string,
  input: { accountId: string; date: string },
): Promise<string> {
  const id = newId();
  const body: CreatePlanItemBody = {
    id,
    // The owner is `tenant:user`; the plan is the person's own.
    userId: owner.split(':')[1]!,
    accountId: input.accountId,
    date: input.date,
  };
  await sync.db.transaction((tx) =>
    sync.outbox.enqueue(tx, { id, owner, kind: 'plan_item.create', payload: body }),
  );
  return id;
}
