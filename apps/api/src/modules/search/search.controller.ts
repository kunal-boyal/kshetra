import { Controller, Get, Query } from '@nestjs/common';
import { SearchQuery, SearchResult } from '@thelamp/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { SearchService } from './search.service';

/** Search across the product (phase 4 step A1, decision D110), for people, never API clients. */
@Controller('v1')
export class SearchController {
  constructor(
    private readonly database: Database,
    private readonly search: SearchService,
  ) {}

  @Get('search')
  @Contract({
    tag: 'Search',
    summary: 'People, accounts, orders and forms matching some words, within the caller’s scope',
    query: SearchQuery,
    response: SearchResult,
  })
  @SignedIn()
  find(@CurrentAccess() access: Access, @Query() query: unknown) {
    const { q } = SearchQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.search.search(tx, access, q));
  }
}
