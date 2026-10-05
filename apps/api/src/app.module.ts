import { type DynamicModule, Module } from '@nestjs/common';
import type { Config } from './config';
import { Database } from './platform/database';
import { HealthController } from './platform/health.controller';
import { CONFIG } from './platform/tokens';

@Module({})
export class AppModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: CONFIG, useValue: config }, Database],
      exports: [Database],
    };
  }
}
