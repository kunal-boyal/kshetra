import { Module } from '@nestjs/common';
import { TerritoriesService } from './territories.service';

/** Geography levels, territory nodes and user attachments (spec 5.4, 9.6). */
@Module({ providers: [TerritoriesService], exports: [TerritoriesService] })
export class TerritoriesModule {}
