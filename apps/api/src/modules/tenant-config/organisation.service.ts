import { Injectable } from '@nestjs/common';
import { AppError, LOGO_TYPES, type OrganisationResult } from '@kshetra/shared';
import sharp from 'sharp';
import { AuditLog, userActor } from '../../platform/audit';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';
import { TenantDirectory } from '../../platform/planes';
import { MediaService } from '../media/media.service';
import { MediaUrls } from '../media/media-urls';
import { TenantConfigService } from './tenant-config.service';

/** The longest side a stored logo keeps: enough for a header at three times density. */
const LOGO_SIDE = 512;

/**
 * The organisation as people see it (M2, spec 5.1, decision D64): its display name, which the
 * directory keeps, and its logo, a file in the media module whose ID the settings hold.
 */
@Injectable()
export class OrganisationService {
  constructor(
    private readonly directory: TenantDirectory,
    private readonly config: TenantConfigService,
    private readonly media: MediaService,
    private readonly urls: MediaUrls,
    private readonly audit: AuditLog,
  ) {}

  async read(tx: TenantTx, tenantId: string): Promise<OrganisationResult> {
    const name = (await this.directory.displayName(tenantId)) ?? '';
    const { logoMediaId } = await this.config.settings(tx, tenantId);
    const key = logoMediaId ? await this.media.objectKey(tx, tenantId, logoMediaId) : null;
    return { name, logo: key ? await this.urls.read(key) : null };
  }

  /** Renames the tenant in the directory, and records it here. */
  async rename(tx: TenantTx, access: Access, name: string): Promise<OrganisationResult> {
    const before = await this.directory.displayName(access.tenantId);
    if (before !== name) {
      await this.directory.rename(access.tenantId, name);
      await this.audit.record(tx, access.tenantId, userActor(access), {
        action: 'organisation.renamed',
        target: { type: 'tenant', id: access.tenantId },
        before: { name: before },
        after: { name },
      });
    }
    return this.read(tx, access.tenantId);
  }

  /**
   * Keeps a new logo: PNG, JPEG or WebP, re-encoded as a PNG of at most 512 pixels a side, which
   * also drops anything hidden in the original file. The old logo's file goes.
   */
  async setLogo(
    tx: TenantTx,
    access: Access,
    contentType: string,
    bytes: Uint8Array,
  ): Promise<OrganisationResult> {
    if (!(LOGO_TYPES as readonly string[]).includes(contentType.split(';')[0]!.trim())) {
      throw new AppError('VALIDATION', 'Use a PNG, JPEG or WebP image.', [
        { path: 'body', issue: 'Use a PNG, JPEG or WebP image' },
      ]);
    }
    let png: Buffer;
    try {
      png = await sharp(bytes)
        .resize({ width: LOGO_SIDE, height: LOGO_SIDE, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch {
      throw new AppError('VALIDATION', 'This image could not be read.', [
        { path: 'body', issue: 'This image could not be read' },
      ]);
    }
    const stored = await this.media.store(tx, access.tenantId, {
      kind: 'logo',
      fileName: 'logo.png',
      contentType: 'image/png',
      bytes: new Uint8Array(png),
      userId: access.userId,
      ownerType: 'tenant',
      ownerId: access.tenantId,
      retentionClass: 'logo',
    });
    await this.replace(tx, access, stored.id);
    return this.read(tx, access.tenantId);
  }

  async removeLogo(tx: TenantTx, access: Access): Promise<OrganisationResult> {
    await this.replace(tx, access, null);
    return this.read(tx, access.tenantId);
  }

  private async replace(tx: TenantTx, access: Access, mediaId: string | null): Promise<void> {
    const { logoMediaId: before } = await this.config.settings(tx, access.tenantId);
    if (before === mediaId) return;
    await this.config.updateSettings(tx, access.tenantId, userActor(access), {
      logoMediaId: mediaId,
    });
    await this.audit.record(tx, access.tenantId, userActor(access), {
      action: 'organisation.logo_changed',
      target: { type: 'tenant', id: access.tenantId },
      before: { logoMediaId: before },
      after: { logoMediaId: mediaId },
    });
    if (before) await this.media.expire(tx, access.tenantId, before);
  }
}
