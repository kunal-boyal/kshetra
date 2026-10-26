import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { Database } from './database';

const FROM_REPLICA = 'fromReplica';

/**
 * Marks a list route whose reads by API clients go to the read replica (spec 11, decision D98):
 * bulk reads that needn't see a write made a moment before. People in the apps keep reading the
 * primary. The route must only read.
 */
export const FromReplica = () => SetMetadata(FROM_REPLICA, true);

/** Runs an API client's request to a `@FromReplica()` route with its reads on the replica. */
@Injectable()
export class ReplicaReads implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: Database,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const marked = this.reflector.get<boolean>(FROM_REPLICA, context.getHandler());
    const access = context.switchToHttp().getRequest<FastifyRequest>().access;
    if (!marked || !access?.apiClient) return next.handle();
    return new Observable((subscriber) =>
      this.database.onReplica(() => next.handle().subscribe(subscriber)),
    );
  }
}
