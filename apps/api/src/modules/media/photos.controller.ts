import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ConfirmMediaBody,
  IdParams,
  MediaResult,
  MediaUrlQuery,
  MediaUrlResult,
  PresignMediaBody,
  PresignMediaResult,
} from '@kshetra/shared';
import { type Access, CurrentAccess, SignedIn } from '../../platform/auth';
import { Database } from '../../platform/database';
import { Contract } from '../../platform/routes';
import { pathId } from '../iam/actor';
import { PhotosService } from './photos.service';

/**
 * Photos (spec 11.2, 12.2). Anyone signed in uploads their own; the forms, visits and claims that
 * use them check their own permissions. Each photo's ID is made on the phone, and both writes are
 * safe to repeat: the same ID with the same file gives the same answer.
 */
@Controller('v1/media')
export class PhotosController {
  constructor(
    private readonly database: Database,
    private readonly photos: PhotosService,
  ) {}

  @Post('presign')
  @Contract({
    tag: 'Media',
    summary: 'Register a photo, and get a link to upload it to',
    body: PresignMediaBody,
    response: PresignMediaResult,
  })
  @SignedIn()
  @HttpCode(200)
  presign(@CurrentAccess() access: Access, @Body() body: unknown) {
    const input = PresignMediaBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) => this.photos.presign(tx, access, input));
  }

  @Post(':id/confirm')
  @Contract({
    tag: 'Media',
    summary: 'Say a photo is uploaded, with when, where and how it was taken',
    params: IdParams,
    body: ConfirmMediaBody,
    response: MediaResult,
  })
  @SignedIn()
  @HttpCode(200)
  confirm(@CurrentAccess() access: Access, @Param('id') id: string, @Body() body: unknown) {
    const mediaId = pathId(id);
    const input = ConfirmMediaBody.parse(body);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.photos.confirm(tx, access, mediaId, input),
    );
  }

  @Get(':id/url')
  @Contract({
    tag: 'Media',
    summary: 'A link to read one variant of a photo, for 5 minutes',
    params: IdParams,
    query: MediaUrlQuery,
    response: MediaUrlResult,
  })
  @SignedIn()
  url(@CurrentAccess() access: Access, @Param('id') id: string, @Query() query: unknown) {
    const mediaId = pathId(id);
    const { variant } = MediaUrlQuery.parse(query);
    return this.database.forTenant(access.tenantId, (tx) =>
      this.photos.url(tx, access, mediaId, variant),
    );
  }
}
