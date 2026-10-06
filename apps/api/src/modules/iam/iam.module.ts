import { Module } from '@nestjs/common';
import { MeController } from './me.controller';

/** Users, roles, permissions, designations, devices and scopes (spec 9.6); this step starts it. */
@Module({ controllers: [MeController] })
export class IamModule {}
