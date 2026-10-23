import { Body, Controller, Get, Headers, Param, Put, Res } from '@nestjs/common';
import { CatalogueResult, ItemBody, ItemParams, ItemResult } from '@thelamp/shared';
import type { FastifyReply } from 'fastify';
import { userActor } from '../../platform/audit';
import { type Access, CurrentAccess, Requires, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { CatalogueService } from './catalogue.service';
import { ItemsService } from './items.service';

/** True when an `If-None-Match` header names this ETag, weak or strong. */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}

/**
 * `GET /v1/catalogue` (spec 11.2): units and items for everyone who fills forms or orders. The
 * ETag carries the catalogue's version, so a phone holding it current gets a 304.
 */
@Controller('v1/catalogue')
export class CatalogueController {
  constructor(
    private readonly database: Database,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get()
  @Contract({
    tag: 'Catalogue',
    summary: 'The catalogue: units and items',
    response: CatalogueResult,
    headers: [{ name: 'If-None-Match', description: 'The ETag of the catalogue the caller holds' }],
    also: [{ status: 304, description: 'The catalogue the caller holds is current' }],
  })
  @SignedIn()
  get(
    @CurrentAccess() access: Access,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CatalogueResult | undefined> {
    return this.database.forTenant(access.tenantId, async (tx) => {
      const etag = `"c${await this.catalogue.version(tx, access.tenantId)}"`;
      void reply.header('etag', etag).header('cache-control', 'private, no-cache');
      if (matches(ifNoneMatch, etag)) {
        void reply.status(304);
        return undefined;
      }
      return this.catalogue.catalogue(tx, access.tenantId);
    });
  }
}

/** `PUT /v1/items/{itemId}` (spec 11.2, decision D77): items as the portal edits them. */
@Controller('v1/items')
export class ItemsController {
  constructor(
    private readonly database: Database,
    private readonly items: ItemsService,
  ) {}

  @Put(':itemId')
  @Contract({
    tag: 'Catalogue',
    summary: 'Add an item with your own ID, or replace it',
    params: ItemParams,
    body: ItemBody,
    response: ItemResult,
    idempotencyKey: true,
    also: [{ status: 201, description: 'The item was added' }],
  })
  @Requires('catalogue.manage')
  async put(
    @CurrentAccess() access: Access,
    @Param('itemId') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const itemId = pathId(id);
    const input = ItemBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'PUT /v1/items/:id', by: access.userId, itemId, input },
        async () => {
          const { item, created } = await this.items.put(
            tx,
            access.tenantId,
            userActor(access),
            itemId,
            input,
          );
          return { status: created ? 201 : 200, body: item };
        },
      ),
    );
    void reply.status(result.status);
    return result.body;
  }
}
