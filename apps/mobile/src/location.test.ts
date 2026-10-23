import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Location from 'expo-location';
import { currentFix, FIX_TIMEOUT_MS } from './location';

jest.mock('expo-location', () => ({
  Accuracy: { Highest: 6 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
}));

const position = (accuracy: number) => ({
  coords: { latitude: 28.6315, longitude: 77.2167, accuracy },
  timestamp: Date.parse('2026-10-23T05:30:00Z'),
  mocked: false,
});
const current = jest.mocked(Location.getCurrentPositionAsync);
const lastKnown = jest.mocked(Location.getLastKnownPositionAsync);

beforeEach(() => {
  jest.useFakeTimers();
  current.mockReset();
  lastKnown.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('currentFix (M4, M5)', () => {
  it('gives the fresh fix when the phone answers', async () => {
    current.mockResolvedValue(position(8) as Location.LocationObject);
    await expect(currentFix()).resolves.toEqual({
      status: 'ready',
      fix: expect.objectContaining({ accuracy: 8, mocked: false }),
    });
    expect(lastKnown).not.toHaveBeenCalled();
  });

  it('stops waiting when the phone never answers, as indoors, and takes a recent position', async () => {
    current.mockReturnValue(new Promise(() => {}));
    lastKnown.mockResolvedValue(position(35) as Location.LocationObject);
    const fix = currentFix();
    await jest.advanceTimersByTimeAsync(FIX_TIMEOUT_MS);
    await expect(fix).resolves.toEqual({
      status: 'ready',
      fix: expect.objectContaining({ accuracy: 35 }),
    });
    expect(lastKnown).toHaveBeenCalledWith({ maxAge: 60_000 });
  });

  it('says the location could not be found when there is no recent position either', async () => {
    current.mockReturnValue(new Promise(() => {}));
    lastKnown.mockResolvedValue(null);
    const fix = currentFix();
    await jest.advanceTimersByTimeAsync(FIX_TIMEOUT_MS);
    await expect(fix).resolves.toEqual({ status: 'unavailable' });
  });
});
