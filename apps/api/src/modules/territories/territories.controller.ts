import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  CreateTerritoryBody,
  IdParams,
  TerritoryListQuery,
  TerritoryLevelsResult,
  TerritoryListResult,
  TerritoryResult,
  UpdateTerritoryBody,
  UpdateTerritoryLevelsBody,
} from '@thelamp/shared';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, ForApiClients, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { TerritoriesService } from './territories.service';

/** Territories (spec 11.2, M4). */
@Controller('v1/territories')
export class TerritoriesController {
  constructor(
    private readonly database: Database,
    private readonly territories: TerritoriesService,
  ) {}

  @Get()
  @Contract({
    tag: 'Territories',
    summary: "The tenant's territory tree and its levels",
    query: TerritoryListQuery,
    response: TerritoryListResult,
  })
  // Every phone already keeps the whole tree (decision D40), so anyone signed in may read it.
  @SignedIn()
  @ForApiClients()
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = TerritoryListQuery.parse(query);
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.territories.list(tx, access.tenantId, input),
      levels: await this.territories.levels(tx, access.tenantId),
    }));
  }

  @Post()
  @Contract({
    tag: 'Territories',
    summary: 'Add a territory under another, or at the top',
    body: CreateTerritoryBody,
    response: TerritoryResult,
    idempotencyKey: true,
  })
  @Requires('territory.manage')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateTerritoryBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/territories', by: access.userId, input },
        async () => ({
          status: 201,
          body: await this.territories.add(tx, access.tenantId, userActor(access), input),
        }),
      ),
    );
    return result.body;
  }

  @Put('levels')
  @Contract({
    tag: 'Territories',
    summary: 'Rename the levels, or add new ones at the bottom',
    body: UpdateTerritoryLevelsBody,
    response: TerritoryLevelsResult,
  })
  @Requires('territory.manage')
  async updateLevels(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = UpdateTerritoryLevelsBody.parse(body);
    const levels = await this.database.forTenant(access.tenantId, (tx) =>
      this.territories.updateLevels(
        tx,
        access.tenantId,
        userActor(access),
        access.userId,
        input.levels,
      ),
    );
    return { levels };
  }

  @Patch(':id')
  @Contract({
    tag: 'Territories',
    summary: 'Rename, recode, move within its level, or switch off or on',
    params: IdParams,
    body: UpdateTerritoryBody,
    response: TerritoryResult,
  })
  @Requires('territory.manage')
  change(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const territoryId = pathId(id);
    const input = UpdateTerritoryBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.territories.change(tx, access.tenantId, userActor(access), territoryId, input),
    );
  }
}
