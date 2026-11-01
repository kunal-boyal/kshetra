import type { MockSource } from '@thelamp/shared';
import { useCallback } from 'react';
import { useApp } from './app-state';
import { reportMocked } from './mocked';
import { useSync } from './sync';

/** For screens: notes a mocked fix the screen refused, for the signed-in person. */
export function useReportMocked(): (source: MockSource) => void {
  const { client } = useApp();
  const sync = useSync();
  const owner = client.owner;
  return useCallback(
    (source: MockSource) => {
      if (sync && owner) void reportMocked(sync, owner, source).catch(() => undefined);
    },
    [sync, owner],
  );
}
