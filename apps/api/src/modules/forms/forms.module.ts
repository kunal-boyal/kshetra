import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { FormsController } from './forms.controller';
import { FormsService } from './forms.service';

/** Forms and their versions (spec 5.6, 9.6). */
@Module({
  imports: [IamModule, TenantConfigModule, AccountsModule],
  controllers: [FormsController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
