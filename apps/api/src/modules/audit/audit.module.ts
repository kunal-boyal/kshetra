import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Viewing the audit log (spec 9.6). Modules write entries with `AuditLog` from the platform, in
 * the same transaction as each change.
 */
@Module({ imports: [IamModule], controllers: [AuditController], providers: [AuditService] })
export class AuditModule {}
