import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CreateWebhookBody,
  IdParams,
  UpdateWebhookBody,
  WebhookDelivery,
  WebhookDeliveryList,
  WebhookDeliveryQuery,
  WebhookList,
  WebhookMessageParams,
  WebhookReplayResult,
  WebhookResult,
  WebhookSecret,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { WebhooksService } from './webhooks.service';

/**
 * Webhooks (spec 11.2, module M20, decision D94), for holders of `webhook.manage`: subscribing a
 * receiver to events, changing or pausing it, rotating its secret, sending a test, the delivery
 * log, and sending a message again.
 */
@Controller('v1/webhooks')
export class WebhooksController {
  constructor(
    private readonly database: Database,
    private readonly webhooks: WebhooksService,
  ) {}

  @Get()
  @Requires('webhook.manage')
  @Contract({ tag: 'Integrations', summary: 'List webhooks', response: WebhookList })
  async list(@CurrentAccess() access: Access) {
    return {
      items: await this.database.forTenant(access.tenantId, (tx) =>
        this.webhooks.list(tx, access.tenantId),
      ),
    };
  }

  @Post()
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Subscribe a receiver to events; its signing secret is shown once',
    body: CreateWebhookBody,
    response: WebhookSecret,
  })
  create(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = CreateWebhookBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.webhooks.create(tx, access, input),
    );
  }

  @Patch(':id')
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Change a webhook’s address or events, or pause it',
    params: IdParams,
    body: UpdateWebhookBody,
    response: WebhookResult,
  })
  update(@CurrentAccess() access: Access, @Param() params: unknown, @Body() body: unknown) {
    const { id } = IdParams.parse(params);
    const input = UpdateWebhookBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.webhooks.update(tx, access, id, input),
    );
  }

  @Post(':id/rotate')
  @HttpCode(200)
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Give a webhook a new signing secret, shown once',
    params: IdParams,
    response: WebhookSecret,
  })
  rotate(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.webhooks.rotate(tx, access, id));
  }

  @Post(':id/test')
  @HttpCode(200)
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Send a test message now, and see what the receiver answered',
    params: IdParams,
    response: WebhookDelivery,
  })
  test(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id } = IdParams.parse(params);
    return this.database.forTenant(access.tenantId, (tx) => this.webhooks.test(tx, access, id));
  }

  @Get(':id/deliveries')
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'A webhook’s delivery log: every try, newest first',
    params: IdParams,
    query: WebhookDeliveryQuery,
    response: WebhookDeliveryList,
  })
  deliveries(@CurrentAccess() access: Access, @Param() params: unknown, @Query() query: unknown) {
    const { id } = IdParams.parse(params);
    const input = WebhookDeliveryQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.webhooks.deliveries(tx, access.tenantId, id, input),
    );
  }

  @Post(':id/messages/:messageId/replay')
  @HttpCode(200)
  @Requires('webhook.manage')
  @Contract({
    tag: 'Integrations',
    summary: 'Send a message again, from its first try',
    params: WebhookMessageParams,
    response: WebhookReplayResult,
  })
  async replay(@CurrentAccess() access: Access, @Param() params: unknown) {
    const { id, messageId } = WebhookMessageParams.parse(params);
    await this.database.forTenant(access.tenantId, (tx) =>
      this.webhooks.replay(tx, access, id, messageId),
    );
    return { queued: true as const };
  }
}
