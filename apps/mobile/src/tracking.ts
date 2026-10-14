import {
  lastPulledAt,
  type Outbox,
  type SqlDatabase,
  Tracking,
  Visits,
} from '@kshetra/api-client/sync';
import {
  type EndShiftBody,
  LocationBatchResult,
  newId,
  type PauseShiftBody,
  type ResumeShiftBody,
  type StartShiftBody,
} from '@kshetra/shared';
import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import type { MobileClient } from './client';
import { sendHeartbeat } from './heartbeat';
import type { Fix } from './location';

/**
 * Tracking during a shift (M5, spec 12.1). Location updates run in a background task with a
 * notification that stays while the shift is tracked. The task keeps only what the server would
 * accept, and uploads at most every few minutes; the sync uploads the rest. It never starts by
 * itself: only punching in or resuming starts it (BR-37).
 */

export const LOCATION_TASK = 'shift-location';

/** The version of the consent text the person accepts at punch-in (M5). */
export const CONSENT_VERSION = '2026-10';

/** The background task uploads when this many points wait, or this long after the last upload. */
const FLUSH_AT_POINTS = 20;
const FLUSH_EVERY_MS = 5 * 60_000;

interface Ready {
  db: SqlDatabase;
  outbox: Outbox;
  tracking: Tracking;
}

/** Whether background updates run now. The web preview has none. */
export async function trackingRuns(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** The words the shift notification shows, in the person's language. */
export interface TrackingNotice {
  title: string;
  body: string;
}

/**
 * Starts background updates at the tenant's interval (spec 12.1): high accuracy, no distance
 * filter, no automatic pausing. Needs background permission; returns whether it started.
 */
export async function startTracking(
  intervalSeconds: number,
  notice: TrackingNotice,
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const background = await Location.getBackgroundPermissionsAsync();
  if (!background.granted) return false;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: intervalSeconds * 1_000,
    deferredUpdatesInterval: intervalSeconds * 1_000,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: notice.title,
      notificationBody: notice.body,
      killServiceOnDestroy: true,
    },
  });
  return true;
}

/** Stops background updates; harmless when they don't run (BR-37). */
export async function stopTracking(): Promise<void> {
  if (await trackingRuns()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
}

/** Whether a shift's punch-in has reached the server, so its points may go. */
async function shiftKnown(outbox: Outbox, owner: string, shiftId: string): Promise<boolean> {
  return !(await outbox.items(owner)).some((item) => item.id === shiftId);
}

/** Uploads waiting points for shifts the server knows (spec 12.1). */
export async function flushPoints(
  sync: Ready,
  client: Pick<MobileClient, 'request'>,
  owner: string,
): Promise<void> {
  await sync.tracking.flush(
    owner,
    async (points) =>
      (await client.request('POST', '/v1/locations/batch', LocationBatchResult, {
        body: { points },
      }))!,
    (shiftId) => shiftKnown(sync.outbox, owner, shiftId),
  );
}

async function battery(): Promise<number | null> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level < 0 ? null : Math.round(level * 100);
  } catch {
    return null;
  }
}

/** What the background task needs; the app sets it up once at start (`registerTrackingTask`). */
interface TaskContext {
  open: () => Promise<Ready>;
  client: () => Promise<MobileClient | null>;
}

let lastFlush = 0;
let lastBeat = 0;
/** On duty, the task reports the phone's health this often (spec 12.1). */
const BEAT_EVERY_MS = 15 * 60_000;

/**
 * Defines the background task. It runs without the app's screens: it opens the phone's database,
 * keeps the points the operating system hands it, and stops tracking once nobody is signed in,
 * the shift has closed or passed its longest length, or permission is gone (BR-37).
 */
export function registerTrackingTask(context: TaskContext): void {
  if (Platform.OS === 'web' || TaskManager.isTaskDefined(LOCATION_TASK)) return;
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
    LOCATION_TASK,
    async ({ data, error }) => {
      if (error) {
        // Permission withdrawn or location switched off: tracking stops (BR-37).
        await stopTracking();
        return;
      }
      const sync = await context.open();
      const [state] = await sync.tracking.openShifts();
      if (!state || Date.now() > state.endsBy) {
        await stopTracking();
        return;
      }
      const level = await battery();
      await sync.tracking.record(
        state.owner,
        (data?.locations ?? []).map((location) => ({
          id: newId(),
          capturedAt: location.timestamp,
          lat: location.coords.latitude,
          lng: location.coords.longitude,
          accuracy: location.coords.accuracy ?? Number.POSITIVE_INFINITY,
          speed:
            location.coords.speed === null || location.coords.speed < 0
              ? null
              : location.coords.speed,
          mocked: location.mocked ?? false,
          battery: level,
          source: 'background',
        })),
      );
      const waiting = await sync.tracking.waiting(state.owner);
      if (waiting < FLUSH_AT_POINTS && Date.now() - lastFlush < FLUSH_EVERY_MS) return;
      const client = await context.client();
      if (!client || client.owner !== state.owner) {
        // Signed out, or someone else signed in: nobody is tracked (BR-37).
        await stopTracking();
        return;
      }
      lastFlush = Date.now();
      await flushPoints(sync, client, state.owner).catch(() => undefined);
      if (Date.now() - lastBeat >= BEAT_EVERY_MS) {
        lastBeat = Date.now();
        const counts = await sync.outbox.counts(state.owner);
        await sendHeartbeat(client, {
          status: { counts, lastPulledAt: await lastPulledAt(sync.db) },
        }).catch(() => undefined);
      }
    },
  );
}

/** The shift's records, queued for upload in the same transaction as the phone's state. */

export interface PunchIn {
  fix: Fix;
  selfieMediaId?: string;
  maxShiftHours: number;
  intervalSeconds: number;
}

/** Punch in (M5): the shift opens on the phone and its punch-in is queued. Returns its ID. */
export async function punchIn(sync: Ready, owner: string, input: PunchIn): Promise<string> {
  const id = newId();
  const startedAt = Date.parse(input.fix.capturedAt);
  const body: StartShiftBody = {
    id,
    startedAt: input.fix.capturedAt,
    location: { lat: input.fix.lat, lng: input.fix.lng },
    accuracy: input.fix.accuracy,
    mocked: input.fix.mocked,
    consentVersion: CONSENT_VERSION,
    ...(input.selfieMediaId ? { selfieMediaId: input.selfieMediaId } : {}),
  };
  await sync.db.transaction(async (tx) => {
    await sync.tracking.open(tx, {
      owner,
      shiftId: id,
      startedAt,
      endsBy: startedAt + input.maxShiftHours * 3_600_000,
      intervalSeconds: input.intervalSeconds,
    });
    await sync.outbox.enqueue(tx, {
      id,
      owner,
      kind: 'shift.start',
      payload: body,
      // A selfie uploads first, so the punch-in can attach it.
      ...(input.selfieMediaId ? { dependsOn: [input.selfieMediaId] } : {}),
    });
  });
  return id;
}

/**
 * Punch out: tracking stops, the shift and any open visit close on the phone (the server checks
 * the visit out at the punch-out), and the punch-out is queued.
 */
export async function punchOut(sync: Ready, owner: string, fix: Fix): Promise<void> {
  const state = await sync.tracking.current(owner);
  if (!state) return;
  await stopTracking();
  const body: EndShiftBody & { shiftId: string } = {
    shiftId: state.shiftId,
    endedAt: fix.capturedAt,
    location: { lat: fix.lat, lng: fix.lng },
    accuracy: fix.accuracy,
    mocked: fix.mocked,
  };
  await sync.db.transaction(async (tx) => {
    await sync.tracking.close(tx, owner);
    await new Visits(sync.db).close(tx, owner);
    await sync.outbox.enqueue(tx, {
      id: newId(),
      owner,
      kind: 'shift.end',
      payload: body,
      dependsOn: [state.shiftId],
    });
  });
}

/** Pause tracking with a reason: GPS stops, attendance doesn't (M5). */
export async function pauseShift(sync: Ready, owner: string, reason: string): Promise<void> {
  const state = await sync.tracking.current(owner);
  if (!state || state.pauseId) return;
  await stopTracking();
  const pauseId = newId();
  const body: PauseShiftBody & { shiftId: string } = {
    shiftId: state.shiftId,
    id: pauseId,
    pausedAt: new Date().toISOString(),
    reason,
  };
  await sync.db.transaction(async (tx) => {
    await sync.tracking.pause(tx, owner, pauseId);
    await sync.outbox.enqueue(tx, {
      id: pauseId,
      owner,
      kind: 'shift.pause',
      payload: body,
      dependsOn: [state.shiftId],
    });
  });
}

/** Resume tracking after a pause. Starting the updates again is the caller's. */
export async function resumeShift(sync: Ready, owner: string): Promise<void> {
  const state = await sync.tracking.current(owner);
  if (!state?.pauseId) return;
  const body: ResumeShiftBody & { shiftId: string; pauseId: string } = {
    shiftId: state.shiftId,
    pauseId: state.pauseId,
    resumedAt: new Date().toISOString(),
  };
  await sync.db.transaction(async (tx) => {
    await sync.tracking.pause(tx, owner, null);
    await sync.outbox.enqueue(tx, {
      id: newId(),
      owner,
      kind: 'shift.resume',
      payload: body,
      dependsOn: [state.pauseId!],
    });
  });
}
