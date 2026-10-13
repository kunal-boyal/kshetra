import { Controller, Get, Headers, Res } from '@nestjs/common';
import { CatalogueResult } from '@kshetra/shared';
import type { FastifyReply } from 'fastify';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { CatalogueService } from './catalogue.service';

/** True when an `If-None-Match` header names this ETag, weak or strong. */
function matches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*');
}

/**
 * `GET /v1/catalogue` (spec 11.2): units and items for everyone who fills forms; prices join in
 * phase 2. The ETag carries the catalogue's version, so a phone holding it current gets a 304.
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
