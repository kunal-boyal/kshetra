import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  AppError,
  CreateImportQuery,
  IdParams,
  ImportExampleQuery,
  ImportListQuery,
  ImportListResult,
  ImportResult,
  UpdateImportMappingBody,
} from '@thelamp/shared';
import { type Access, CurrentAccess, Requires } from '../../platform/auth';
import { Database } from '../../platform/database';
import { idempotent, requireIdempotencyKey } from '../../platform/idempotency';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import type { FastifyReply } from 'fastify';
import { ImportExamples } from './examples';
import { ImportsService } from './imports.service';

/** Imports (spec 11.2, M19). Each target needs its own permission too, such as `user.manage`. */
@Controller('v1/imports')
export class ImportsController {
  constructor(
    private readonly database: Database,
    private readonly imports: ImportsService,
    private readonly examples: ImportExamples,
  ) {}

  @Post()
  @Contract({
    tag: 'Imports',
    summary: 'Upload an XLSX or CSV file to import, as the request body',
    query: CreateImportQuery,
    response: ImportResult,
    idempotencyKey: true,
    headers: [
      {
        name: 'Content-Type',
        description:
          'text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet or application/octet-stream',
      },
    ],
  })
  @Requires('import.run')
  @HttpCode(201)
  async create(
    @CurrentAccess() access: Access,
    @Query() query: unknown,
    @Body() body: unknown,
    @Headers('content-type') contentType: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
  ) {
    const input = CreateImportQuery.parse(query);
    if (!(body instanceof Uint8Array)) {
      throw new AppError('VALIDATION', 'Send the file itself as the body.', [
        { path: 'body', issue: 'Send the file with Content-Type text/csv or the XLSX type' },
      ]);
    }
    const sha256 = createHash('sha256').update(body).digest('hex');
    const result = await this.database.forTenant(access.tenantId, (tx) =>
      idempotent(
        tx,
        access.tenantId,
        requireIdempotencyKey(key),
        { route: 'POST /v1/imports', by: access.userId, ...input, sha256 },
        async () => ({
          status: 201,
          body: await this.imports.create(tx, access, input, contentType ?? '', body),
        }),
      ),
    );
    return result.body;
  }

  @Get()
  @Contract({
    tag: 'Imports',
    summary: 'Imports, newest first',
    query: ImportListQuery,
    response: ImportListResult,
  })
  @Requires('import.run')
  list(@CurrentAccess() access: Access, @Query() query: unknown) {
    const input = ImportListQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) => this.imports.list(tx, access, input));
  }

  @Get('example')
  @Contract({
    tag: 'Imports',
    summary: 'An example XLSX for a target: its columns, example rows and what each column is',
    query: ImportExampleQuery,
    file: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  @Requires('import.run')
  async example(
    @CurrentAccess() access: Access,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { target, locale } = ImportExampleQuery.parse(query);
    const file = await this.database.forTenant(access.tenantId, (tx) =>
      this.examples.workbook(tx, access, target, locale),
    );
    void reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header(
        'content-disposition',
        `attachment; filename="example-${target.replace(':', '-')}.xlsx"`,
      )
      .header('cache-control', 'private, no-store');
    return file;
  }

  @Get(':id')
  @Contract({
    tag: 'Imports',
    summary: 'One import: where it has got to, its mapping, problems and preview',
    params: IdParams,
    response: ImportResult,
  })
  @Requires('import.run')
  get(@CurrentAccess() access: Access, @Param('id') id: string) {
    const importId = pathId(id);
    return this.database.forTenant(access.tenantId, (tx) => this.imports.get(tx, access, importId));
  }

  @Put(':id/mapping')
  @Contract({
    tag: 'Imports',
    summary: 'Choose another sheet, or confirm which column fills which field and check the rows',
    params: IdParams,
    body: UpdateImportMappingBody,
    response: ImportResult,
  })
  @Requires('import.run')
  setMapping(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const importId = pathId(id);
    const input = UpdateImportMappingBody.parse(body);
    // Sending the same mapping again checks the same rows again, so it needs no key.
    return this.database.forTenant(access.tenantId, (tx) =>
      this.imports.setMapping(tx, access, importId, input),
    );
  }

  @Post(':id/commit')
  @Contract({
    tag: 'Imports',
    summary: 'Import every row of a checked file, or none',
    params: IdParams,
    response: ImportResult,
  })
  @Requires('import.run')
  @HttpCode(200)
  commit(@CurrentAccess() access: Access, @Param('id') id: string) {
    const importId = pathId(id);
    // Committing again while it runs, or after, changes nothing, so it needs no key.
    return this.database.forTenant(access.tenantId, (tx) =>
      this.imports.commit(tx, access, importId),
    );
  }
}
