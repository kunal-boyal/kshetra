import type { GeoPoint } from '@thelamp/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

/** Where the phone is, how sure it is, and when it knew (spec 12.1). */
export interface Fix extends GeoPoint {
  /** Metres, as the phone reports it. */
  accuracy: number;
  capturedAt: string;
  /** Whether the operating system says the fix is mocked (Android only). */
  mocked: boolean;
}

export type FixState =
  | { status: 'locating' }
  | { status: 'ready'; fix: Fix }
  | { status: 'denied' }
  | { status: 'unavailable' };

/** How long a fix may take before the phone's last known position stands in, or none does. */
export const FIX_TIMEOUT_MS = 20_000;
/** The oldest last known position that may stand in for a fresh fix. */
const LAST_KNOWN_MAX_AGE_MS = 60_000;

function fixOf(position: Location.LocationObject): Fix {
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
    capturedAt: new Date(position.timestamp).toISOString(),
    mocked: position.mocked ?? false,
  };
}

/**
 * A fresh fix, asking for permission while the app is open the first time (M4). Only the
 * foreground: tracking during a shift asks for more when it arrives. Android may never answer a
 * request for its best fix indoors, so after FIX_TIMEOUT_MS a position from the last minute
 * stands in, and without one the person is told to step outside (decision D68). The server
 * still judges each fix's accuracy.
 */
export async function currentFix(): Promise<FixState> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
      }),
    ]);
    if (position) return { status: 'ready', fix: fixOf(position) };
    const recent = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    return recent ? { status: 'ready', fix: fixOf(recent) } : { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** A fix taken when the screen opens, and again on asking. */
export function useFix(): FixState & { refresh: () => void } {
  const [state, setState] = useState<FixState>({ status: 'locating' });
  const refresh = useCallback(() => {
    setState({ status: 'locating' });
    void currentFix().then(setState);
  }, []);
  useEffect(() => {
    let live = true;
    void currentFix().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return { ...state, refresh };
}
