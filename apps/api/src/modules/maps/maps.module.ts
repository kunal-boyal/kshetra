import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { FieldModule } from '../field/field.module';
import { IamModule } from '../iam/iam.module';
import { TenantConfigModule } from '../tenant-config/tenant-config.module';
import { MapsController } from './maps.controller';
import { MapsService } from './maps.service';

/** Maps (M17, decision D60): reads over shifts, points, trails, visits and accounts. */
@Module({
  imports: [IamModule, AccountsModule, FieldModule, TenantConfigModule],
  controllers: [MapsController],
  providers: [MapsService],
})
export class MapsModule {}
