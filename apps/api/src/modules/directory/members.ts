import { Injectable } from '@nestjs/common';
import { newId } from '@thelamp/shared';
import { and, eq, ne } from 'drizzle-orm';
import {
  identities,
  memberships,
  refreshTokens,
  ssoSubjects,
  totpSecrets,
} from '../../db/schema/directory';
import { type MemberState, MembershipSync } from '../../platform/planes';
import { DirectoryDatabase, type DirectoryTx } from './directory.database';

/**
 * Keeps memberships in step with the users of each cell. Every message carries the user's whole
 * sign-in state, and one older than what is already here is ignored, so a late or repeated message
 * can never bring back access that a later change took away.
 */
@Injectable()
export class DirectoryMembers extends MembershipSync {
  constructor(private readonly database: DirectoryDatabase) {
    super();
  }

  async sync(member: MemberState): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(memberships)
        .where(
          and(eq(memberships.tenantId, member.tenantId), eq(memberships.userId, member.userId)),
        )
        .for('update');
      if (existing && member.authRevision < existing.authRevision) return;

      if (!member.phone || !member.active) {
        if (existing) {
          await tx
            .update(memberships)
            .set({ status: 'inactive', authRevision: member.authRevision })
            .where(eq(memberships.id, existing.id));
        }
        return;
      }

      const identityId = await this.identityFor(tx, member.phone);
      // The cell keeps phone numbers unique in a tenant, so another active membership with this
      // number there is out of date, and its user's own change is on its way.
      await tx
        .update(memberships)
        .set({ status: 'inactive' })
        .where(
          and(
            eq(memberships.tenantId, member.tenantId),
            eq(memberships.identityId, identityId),
            ne(memberships.userId, member.userId),
            eq(memberships.status, 'active'),
          ),
        );
      if (existing) {
        await tx
          .update(memberships)
          .set({ identityId, status: 'active', authRevision: member.authRevision })
          .where(eq(memberships.id, existing.id));
      } else {
        await tx.insert(memberships).values({
          id: newId(),
          identityId,
          tenantId: member.tenantId,
          userId: member.userId,
          status: 'active',
          authRevision: member.authRevision,
        });
      }
    });
  }

  /** The identity for a phone number, created on first use. */
  private async identityFor(tx: DirectoryTx, phone: string): Promise<string> {
    await tx
      .insert(identities)
      .values({ id: newId(), phoneE164: phone })
      .onConflictDoNothing({ target: identities.phoneE164 });
    const [identity] = await tx
      .select({ id: identities.id })
      .from(identities)
      .where(eq(identities.phoneE164, phone));
    if (!identity) throw new Error('An identity was created but could not be read back.');
    return identity.id;
  }

  async forget(tenantId: string, userId: string): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [membership] = await tx
        .select({ id: memberships.id, identityId: memberships.identityId })
        .from(memberships)
        .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
        .for('update');
      if (!membership) return;
      await tx.delete(refreshTokens).where(eq(refreshTokens.membershipId, membership.id));
      await tx.delete(ssoSubjects).where(eq(ssoSubjects.membershipId, membership.id));
      await tx.delete(memberships).where(eq(memberships.id, membership.id));
      const [other] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.identityId, membership.identityId))
        .limit(1);
      if (other) return;
      await tx.delete(totpSecrets).where(eq(totpSecrets.identityId, membership.identityId));
      await tx.delete(identities).where(eq(identities.id, membership.identityId));
    });
  }
}
