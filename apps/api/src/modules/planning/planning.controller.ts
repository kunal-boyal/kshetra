import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreatePlanItemBody,
  CreateRouteBody,
  GeneratePlanBody,
  GeneratePlanResult,
  IdParams,
  PlanItemListQuery,
  PlanItemListResult,
  PlanItemResult,
  RouteListQuery,
  RouteListResult,
  RouteResult,
  SubmitPlanBody,
  SubmitPlanResult,
  UpdateRouteBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { PlanningService } from './planning.service';

/**
 * Journey plans (spec 11.2 Planning group, M8): routes, generating a month, plan items, and
 * sending a month for approval. Creates carry their own IDs or an `Idempotency-Key` (BR-46).
 */
@Controller('v1')
export class PlanningController {
  constructor(
    private readonly database: Database,
    private readonly planning: PlanningService,
  ) {}

  @Get('routes')
  @Contract({
    tag: 'Planning',
    summary: "A person's routes",
    query: RouteListQuery,
    response: RouteListResult,
  })
  @RequiresAny('route.manage', 'plan_item.manage', 'visit.use')
  routes(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = RouteListQuery.parse(query);
    return this.database.forTenant(access.tenantId, async (tx) => ({
      items: await this.planning.routes(tx, access, input.userId),
    }));
  }

  @Post('routes')
  @HttpCode(201)
  @Contract({
    tag: 'Planning',
    summary: 'Add a route',
    body: CreateRouteBody,
    response: RouteResult,
  })
  @Requires('route.manage')
  async createRoute(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateRouteBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `route:${input.id}`,
        { route: 'POST /v1/routes', by: access.userId, input },
        async () => ({ status: 201, body: await this.planning.createRoute(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Patch('routes/:id')
  @Contract({
    tag: 'Planning',
    summary: 'Change a route: its name, recurrence, accounts, or switch it off',
    params: IdParams,
    body: UpdateRouteBody,
    response: RouteResult,
  })
  @Requires('route.manage')
  updateRoute(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const routeId = pathId(id);
    const input = UpdateRouteBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.planning.updateRoute(tx, access, routeId, input),
    );
  }

  @Post('plans/generate')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary:
      "Make a person's plan items for a month from their routes; running it again adds nothing twice",
    body: GeneratePlanBody,
    response: GeneratePlanResult,
    idempotencyKey: true,
  })
  @Requires('plan_item.manage')
  async generate(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = GeneratePlanBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/plans/generate', by: access.userId, input },
        async () => ({ status: 200, body: await this.planning.generate(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Post('plans/submit')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary: "Send a person's month of plan items for approval",
    body: SubmitPlanBody,
    response: SubmitPlanResult,
    idempotencyKey: true,
  })
  @RequiresAny('plan_item.manage', 'visit.use')
  async submit(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = SubmitPlanBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/plans/submit', by: access.userId, input },
        async () => ({
          status: 200,
          body: await this.planning.submit(tx, access, input.userId, input.period),
        }),
      ),
    );
    return result.body;
  }

  @Get('plan-items')
  @Contract({
    tag: 'Planning',
    summary: "A person's plan items for a month, by date",
    query: PlanItemListQuery,
    response: PlanItemListResult,
  })
  @RequiresAny('plan_item.manage', 'user.view', 'visit.use')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = PlanItemListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.planning.list(tx, access, input));
  }

  @Post('plan-items')
  @HttpCode(201)
  @Contract({
    tag: 'Planning',
    summary: 'Plan a visit by hand',
    body: CreatePlanItemBody,
    response: PlanItemResult,
  })
  @RequiresAny('plan_item.manage', 'visit.use')
  async create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreatePlanItemBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `plan_item:${input.id}`,
        { route: 'POST /v1/plan-items', by: access.userId, input },
        async () => ({ status: 201, body: await this.planning.create(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Post('plan-items/:id/cancel')
  @HttpCode(200)
  @Contract({
    tag: 'Planning',
    summary: 'Cancel a planned visit',
    params: IdParams,
    response: PlanItemResult,
  })
  @Requires('plan_item.manage')
  cancel(@CurrentAccess() access: Access, @Param('id') id: string) {
    const itemId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.planning.cancel(tx, access, itemId),
    );
  }
}
