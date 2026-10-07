import { Controller, Get, Query } from '@nestjs/common';
import { SyncPullQuery, SyncPullResult } from '@kshetra/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { SyncService } from './sync.service';

/** The mobile sync (spec 11.2, 11.3). */
@Controller('v1/sync')
export class SyncController {
  constructor(
    private readonly database: Database,
    private readonly sync: SyncService,
  ) {}

  @Get('pull')
  @Contract({
    tag: 'Sync',
    summary: 'The next page of the reference data the caller may read offline',
    query: SyncPullQuery,
    response: SyncPullResult,
    also: [{ status: 410, description: 'SYNC_RESET: drop the cursor and pull from the start' }],
  })
  @SignedIn()
  pull(@CurrentAccess() access: Access, @Query() query: unknown): Promise<SyncPullResult> {
    const input = SyncPullQuery.parse(query);
    // One snapshot for the whole pull, so the horizon, the scopes and the rows agree.
    return this.database.forTenant(access.tenantId, (tx) => this.sync.pull(tx, access, input), {
      isolation: 'repeatable read',
      readOnly: true,
    });
  }
}
