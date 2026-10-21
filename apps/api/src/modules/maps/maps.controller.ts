import { Controller, Get, Query } from '@nestjs/common';
import {
  AccountPinsQuery,
  AccountPinsResult,
  DensityQuery,
  DensityResult,
  LiveResult,
  TrailQuery,
  TrailResult,
} from '@kshetra/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { MapsService } from './maps.service';

/** Maps (M17): the live map, account pins, a person's day replayed, and visit density. */
@Controller('v1')
export class MapsController {
  constructor(
    private readonly database: Database,
    private readonly maps: MapsService,
  ) {}

  @Get('live')
  @Contract({
    tag: 'Maps',
    summary: 'Everyone on duty in scope, with their newest position and current visit',
    response: LiveResult,
  })
  @Requires('live_map.view')
  live(@CurrentAccess() access: Access) {
    return this.database.forTenant(access.tenantId, (tx) => this.maps.live(tx, access));
  }

  @Get('account-pins')
  @Contract({
    tag: 'Maps',
    summary: 'The located accounts the caller sees, marked when visited in the month',
    query: AccountPinsQuery,
    response: AccountPinsResult,
  })
  @Requires('account.view')
  pins(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = AccountPinsQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.maps.pins(tx, access, input.period),
    );
  }

  @Get('trails')
  @Contract({
    tag: 'Maps',
    summary: "A person's day: routes, gaps, pauses and visits",
    query: TrailQuery,
    response: TrailResult,
  })
  @Requires('trail.view')
  trail(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = TrailQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.maps.trail(tx, access, input.userId, input.date),
    );
  }

  @Get('density')
  @Contract({
    tag: 'Maps',
    summary: "Where the scope's visits happened over a month, on a grid",
    query: DensityQuery,
    response: DensityResult,
  })
  @RequiresAny('live_map.view', 'trail.view')
  density(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = DensityQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.maps.density(tx, access, input.period),
    );
  }
}
