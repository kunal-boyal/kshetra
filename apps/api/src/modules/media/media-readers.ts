import { Injectable } from '@nestjs/common';
import type { Access } from '../../platform/auth';
import type { TenantTx } from '../../platform/database';

/**
 * Whether the caller may read a photo of a record, as the module that owns the record judges; the
 * photo's kind lets a module open some of a record's photos and not others.
 */
export type MediaReadCheck = (
  tx: TenantTx,
  access: Access,
  ownerId: string,
  kind: string,
) => Promise<boolean>;

/**
 * Who else may see a photo (decision D142). A photo is served to whoever took it and to those
 * whose scope reaches them; the module that owns its record may add the people that record is
 * shown to, such as a claim's approvers outside that scope. Each module registers its owner types
 * in `onModuleInit`; a photo whose owner no check opens stays with its taker and their managers.
 */
@Injectable()
export class MediaReaders {
  private readonly checks = new Map<string, MediaReadCheck[]>();

  register(ownerType: string, check: MediaReadCheck): void {
    this.checks.set(ownerType, [...(this.checks.get(ownerType) ?? []), check]);
  }

  /** Whether any module that registered the photo's owner type lets the caller read it. */
  async may(
    tx: TenantTx,
    access: Access,
    photo: { ownerType: string | null; ownerId: string | null; kind: string },
  ): Promise<boolean> {
    const { ownerType, ownerId, kind } = photo;
    if (!ownerType || !ownerId) return false;
    for (const check of this.checks.get(ownerType) ?? []) {
      if (await check(tx, access, ownerId, kind)) return true;
    }
    return false;
  }
}
