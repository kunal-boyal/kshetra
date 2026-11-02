import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  BounceCollectionBody,
  CollectionDecisionsBody,
  CollectionDecisionsResult,
  CollectionListQuery,
  CollectionListResult,
  CollectionResult,
  IdParams,
  MatchCollectionBody,
  RecordCollectionBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, InModule, Requires, RequiresAny } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { CollectionsService } from './collections.service';

/**
 * Collections (M11, BR-63, decision D132): money taken from accounts in the field, which the
 * office confirms, rejects or marks bounced, and which are matched to the books' receipts.
 */
@Controller('v1/collections')
@InModule('account_finance')
export class CollectionsController {
  constructor(
    private readonly database: Database,
    private readonly collections: CollectionsService,
  ) {}

  // A phone sends a collection with its own ID; sending it again answers as the first time.
  @Post()
  @HttpCode(201)
  @Contract({
    tag: 'Collections',
    summary: 'Record money taken from an account, with its references and the cheque’s photo',
    body: RecordCollectionBody,
    response: CollectionResult,
  })
  @Requires('collection.record')
  async record(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = RecordCollectionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        `collection:${input.id}`,
        { route: 'POST /v1/collections', by: access.userId, input },
        async () => ({ status: 201, body: await this.collections.record(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get()
  @Contract({
    tag: 'Collections',
    summary: 'Collections, newest first: the caller’s own, or those in their reach',
    query: CollectionListQuery,
    response: CollectionListResult,
  })
  @RequiresAny('collection.record', 'collection.view')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = CollectionListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.collections.list(tx, access, input),
    );
  }

  @Post('decisions')
  @Contract({
    tag: 'Collections',
    summary: 'Confirm or reject several collections, each on its own',
    body: CollectionDecisionsBody,
    response: CollectionDecisionsResult,
    idempotencyKey: true,
  })
  @Requires('collection.confirm')
  @HttpCode(200)
  async decide(
    @CurrentAccess() access: Access,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CollectionDecisionsBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/collections/decisions', by: access.userId, input },
        async () => ({ status: 200, body: await this.collections.decide(tx, access, input) }),
      ),
    );
    return result.body;
  }

  @Get(':id')
  @Contract({
    tag: 'Collections',
    summary: 'One collection, with its decision and the receipt it was matched to',
    params: IdParams,
    response: CollectionResult,
  })
  @RequiresAny('collection.record', 'collection.view')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const collectionId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.collections.get(tx, access, collectionId),
    );
  }

  @Post(':id/bounce')
  @Contract({
    tag: 'Collections',
    summary: 'Mark a confirmed cheque bounced, with why',
    params: IdParams,
    body: BounceCollectionBody,
    response: CollectionResult,
    idempotencyKey: true,
  })
  @Requires('collection.confirm')
  @HttpCode(200)
  async bounce(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const collectionId = pathId(id);
    const input = BounceCollectionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/collections/:id/bounce', by: access.userId, collectionId, input },
        async () => ({
          status: 200,
          body: await this.collections.bounce(tx, access, collectionId, input.reason),
        }),
      ),
    );
    return result.body;
  }

  @Post(':id/match')
  @Contract({
    tag: 'Collections',
    summary: 'Match a confirmed collection to the books’ receipt for it, by hand',
    params: IdParams,
    body: MatchCollectionBody,
    response: CollectionResult,
    idempotencyKey: true,
  })
  @Requires('collection.confirm')
  @HttpCode(200)
  async match(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const collectionId = pathId(id);
    const input = MatchCollectionBody.parse(body);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/collections/:id/match', by: access.userId, collectionId, input },
        async () => ({
          status: 200,
          body: await this.collections.matchByHand(tx, access, collectionId, input.receiptId),
        }),
      ),
    );
    return result.body;
  }

  @Post(':id/unmatch')
  @Contract({
    tag: 'Collections',
    summary: 'Undo a match made by mistake; the collection waits for its receipt again',
    params: IdParams,
    response: CollectionResult,
    idempotencyKey: true,
  })
  @Requires('collection.confirm')
  @HttpCode(200)
  async unmatch(
    @CurrentAccess() access: Access,
    @Param('id') id: string,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const collectionId = pathId(id);
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/collections/:id/unmatch', by: access.userId, collectionId },
        async () => ({
          status: 200,
          body: await this.collections.unmatch(tx, access, collectionId),
        }),
      ),
    );
    return result.body;
  }
}
