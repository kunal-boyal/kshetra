import type { GeoPoint } from '@kshetra/shared';
import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

/** Where the phone is, how sure it is, and when it knew (spec 12.1). */
export interface Fix extends GeoPoint {
  /** Metres, as the phone reports it. */
  accuracy: number;
  capturedAt: string;
}

export type FixState =
  | { status: 'locating' }
  | { status: 'ready'; fix: Fix }
  | { status: 'denied' }
  | { status: 'unavailable' };

/**
 * A fresh fix, asking for permission while the app is open the first time (M4). Only the
 * foreground: tracking during a shift asks for more when it arrives.
 */
export async function currentFix(): Promise<FixState> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) return { status: 'denied' };
  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Highest,
    });
    return {
      status: 'ready',
      fix: {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy ?? Number.POSITIVE_INFINITY,
        capturedAt: new Date(position.timestamp).toISOString(),
      },
    };
  } catch {
    return { status: 'unavailable' };
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
