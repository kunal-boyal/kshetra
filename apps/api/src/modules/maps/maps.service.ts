import { Injectable } from '@nestjs/common';
import {
  type AccountPinsResult,
  decodePolyline,
  DENSITY_CELL_DEG,
  type DensityResult,
  type LiveResult,
  offPlan,
  pathLengthMeters,
  todayIn,
  type TrailResult,
} from '@thelamp/shared';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { localMonth } from '../../platform/local-day';
import { AccountsService } from '../accounts/accounts.service';
import { LocationsService } from '../field/locations.service';
import { ShiftsService } from '../field/shifts.service';
import { TrailsService } from '../field/trails.service';
import { VisitsService } from '../field/visits.service';
import { notFound, outOfScope } from '../iam/actor';
import { People } from '../iam/people';
import { Scopes } from '../iam/scopes';
import { PlanningService } from '../planning/planning.service';
import { TenantConfigService } from '../tenant-config/tenant-config.service';

/** The most account pins one map takes (M17). */
const PIN_LIMIT = 5_000;

/** A silence longer than this between fixes is a gap in the replay (M5). */
const GAP_MS = 10 * 60_000;

/**
 * Maps (M17, decision D60): who is on duty and where, the accounts on a map, a person's day
 * replayed, and where visits happened over a month. Everything is limited to the caller's scope.
 */
@Injectable()
export class MapsService {
  constructor(
    private readonly scopes: Scopes,
    private readonly people: People,
    private readonly config: TenantConfigService,
    private readonly accounts: AccountsService,
    private readonly shifts: ShiftsService,
    private readonly visits: VisitsService,
    private readonly locations: LocationsService,
    private readonly trails: TrailsService,
    private readonly planning: PlanningService,
  ) {}

  /**
   * Everyone on duty in the caller's scope, with their newest position, current visit, today's
   * visits against their plan, where they are, and whether they are off the plan (decision D104).
   */
  async live(tx: TenantTx, access: Access): Promise<LiveResult> {
    const tenantId = access.tenantId;
    const rows = await this.shifts.onDuty(tx, tenantId, await this.scopes.userIds(tx, access));
    const ids = rows.map((row) => row.userId);
    const people = await this.people.facts(tx, tenantId, ids);
    const visits = await this.visits.openFor(tx, tenantId, ids);
    const { timezone, geofenceRadiusMeters } = await this.config.settings(tx, tenantId);
    const today = todayIn(timezone);
    const done = await this.visits.dayCounts(tx, tenantId, ids, today, timezone);
    const plans = await this.planning.todayFor(tx, tenantId, ids, today);
    const places = await this.accounts.geofences(tx, tenantId, [...plans.values()].flat());
    return {
      people: rows.flatMap((row) => {
        const person = people.get(row.userId);
        if (!person) return [];
        const visit = visits.get(row.userId);
        const planned = plans.get(row.userId);
        return [
          {
            user: { id: person.id, code: person.code, name: person.name },
            shiftId: row.shiftId,
            onDutySince: row.startedAt.toISOString(),
            paused: row.paused,
            position: row.position,
            accuracy: row.accuracy,
            battery: row.battery,
            seenAt: row.seenAt?.toISOString() ?? null,
            visit: visit
              ? { account: visit.account, checkInAt: visit.checkInAt.toISOString() }
              : null,
            visits: { done: done.get(row.userId)?.visits ?? 0, planned: planned?.length ?? null },
            place: visit?.account.name ?? done.get(row.userId)?.last ?? null,
            offPlan: offPlan(
              row.position,
              (planned ?? []).flatMap((id) => {
                const place = places.get(id);
                return place ? [place.location] : [];
              }),
              geofenceRadiusMeters,
            ),
          },
        ];
      }),
      readAt: new Date().toISOString(),
    };
  }

  /** The located accounts the caller sees, marked when anyone visited them in the month. */
  async pins(tx: TenantTx, access: Access, period?: string): Promise<AccountPinsResult> {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const month = period ?? todayIn(timezone).slice(0, 7);
    const { from, to } = localMonth(month, timezone);
    const found = await this.accounts.pins(tx, access, PIN_LIMIT);
    const visited = await this.visits.accountsVisited(tx, access.tenantId, from, to);
    return {
      period: month,
      items: found.items.map((pin) => ({ ...pin, visited: visited.has(pin.id) })),
      truncated: found.truncated,
    };
  }

  /**
   * A person's day (M17): each shift's route from accurate fixes while they are kept, else the
   * compacted trail, with gaps and pauses, and the day's visits with their geofence results.
   */
  async trail(tx: TenantTx, access: Access, userId: string, date: string): Promise<TrailResult> {
    const tenantId = access.tenantId;
    const person = (await this.people.facts(tx, tenantId, [userId])).get(userId);
    if (!person) throw notFound();
    if (!(await this.scopes.reaches(tx, access, userId))) throw outOfScope();
    const { timezone } = await this.config.settings(tx, tenantId);
    const shifts = await this.shifts.ofDay(tx, tenantId, userId, date, timezone);
    const stored = await this.trails.stored(
      tx,
      tenantId,
      shifts.map((shift) => shift.id),
    );
    const replayed = [];
    for (const shift of shifts) {
      const fixes = await this.locations.fixes(tx, tenantId, shift);
      const trail = stored.get(shift.id);
      const pauses = shift.pauses.map((pause) => ({
        from: pause.from.toISOString(),
        to: pause.to?.toISOString() ?? null,
      }));
      if (fixes.length > 0 || !trail) {
        const gaps = [];
        for (let index = 1; index < fixes.length; index += 1) {
          const from = fixes[index - 1]!.capturedAt;
          const to = fixes[index]!.capturedAt;
          if (to.getTime() - from.getTime() > GAP_MS) {
            gaps.push({ from: from.toISOString(), to: to.toISOString() });
          }
        }
        replayed.push({
          id: shift.id,
          startedAt: shift.startedAt.toISOString(),
          endedAt: shift.endedAt?.toISOString() ?? null,
          source: 'points' as const,
          points: fixes.map((fix) => ({
            lat: fix.lat,
            lng: fix.lng,
            at: fix.capturedAt.toISOString(),
          })),
          distanceM: shift.distanceM ?? Math.round(pathLengthMeters(fixes)),
          gaps,
          pauses,
        });
      } else {
        replayed.push({
          id: shift.id,
          startedAt: shift.startedAt.toISOString(),
          endedAt: shift.endedAt?.toISOString() ?? null,
          source: 'trail' as const,
          points: decodePolyline(trail.polyline).map((point) => ({ ...point, at: null })),
          distanceM: trail.distanceM,
          gaps: trail.gaps,
          pauses,
        });
      }
    }
    const visits = await this.visits.ofDay(tx, tenantId, userId, date, timezone);
    return {
      user: { id: person.id, code: person.code, name: person.name },
      date,
      shifts: replayed,
      visits: visits.flatMap((visit) =>
        visit.location
          ? [
              {
                id: visit.id,
                account: { id: visit.accountId, code: visit.code, name: visit.name },
                location: visit.location,
                checkInAt: visit.checkInAt.toISOString(),
                checkOutAt: visit.checkOutAt?.toISOString() ?? null,
                geofence: visit.geofence,
                distanceM: visit.distanceM,
              },
            ]
          : [],
      ),
    };
  }

  /** Where the caller's scope checked in over a month, counted on a grid of about 1 km. */
  async density(tx: TenantTx, access: Access, period: string): Promise<DensityResult> {
    const { timezone } = await this.config.settings(tx, access.tenantId);
    const { from, to } = localMonth(period, timezone);
    const cells = await this.visits.density(
      tx,
      access.tenantId,
      await this.scopes.userIds(tx, access),
      from,
      to,
      DENSITY_CELL_DEG,
    );
    return {
      period,
      cell: DENSITY_CELL_DEG,
      cells,
      visits: cells.reduce((sum, cell) => sum + cell.visits, 0),
    };
  }
}
