import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { UserHistoryController } from './user-history.controller';

/**
 * Viewing the audit log (spec 9.6), and each person's history from it. Modules write entries with
 * `AuditLog` from the platform, in the same transaction as each change.
 */
@Module({
  imports: [IamModule],
  controllers: [AuditController, UserHistoryController],
  providers: [AuditService],
})
export class AuditModule {}
