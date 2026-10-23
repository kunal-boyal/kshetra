import { localRows, type RowOf } from '@thelamp/api-client/sync';
import type { SyncEntity } from '@thelamp/shared';
import { useEffect, useState } from 'react';
import { useSync, useSyncStatus } from './sync';

/**
 * What the phone keeps of one entity (spec 11.3), read again after every sync and every capture,
 * so a screen works the same with or without signal. Undefined while it is read.
 */
export function useLocalRows<Name extends SyncEntity>(name: Name): RowOf<Name>[] | undefined {
  const sync = useSync();
  const status = useSyncStatus();
  const [rows, setRows] = useState<RowOf<Name>[]>();
  useEffect(() => {
    if (!sync) return;
    let live = true;
    void localRows(sync.db, name).then((found) => {
      if (live) setRows(found);
    });
    return () => {
      live = false;
    };
  }, [sync, status, name]);
  // Without its database the phone keeps nothing offline.
  return sync ? rows : [];
}
