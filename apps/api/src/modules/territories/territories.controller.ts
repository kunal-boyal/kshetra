import { Controller, Get, Query } from '@nestjs/common';
import { TerritoryListQuery, TerritoryListResult } from '@kshetra/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { TerritoriesService } from './territories.service';

/** Territories (spec 11.2). Creating and changing them arrives with step 4 of phase 1. */
@Controller('v1/territories')
export class TerritoriesController {
  constructor(
    private readonly database: Database,
    private readonly territories: TerritoriesService,
  ) {}

  @Get()
  @Contract({
    tag: 'Territories',
    summary: "The tenant's territory tree",
    query: TerritoryListQuery,
    response: TerritoryListResult,
  })
  // Every phone already keeps the whole tree (decision D40), so anyone signed in may read it.
  @SignedIn()
  async list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = TerritoryListQuery.parse(query);
    const items = await this.database.forTenant(access.tenantId, (tx) =>
      this.territories.list(tx, access.tenantId, input),
    );
    return { items };
  }
}
