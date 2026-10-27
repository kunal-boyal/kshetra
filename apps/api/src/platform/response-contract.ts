import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { map, type Observable } from 'rxjs';
import type { Config } from '../config';
import { reportError } from './error-reports';
import { CONTRACT, type RouteContract } from './routes';
import { CONFIG } from './tokens';

/**
 * Every JSON answer passes through its route's declared response schema (ASVS V8.2.3, decision
 * D101): a field the schema doesn't name never leaves, so a handler can't let out a column it
 * forgot to leave behind. An answer that doesn't fit its schema is a bug: in tests and
 * development it fails loudly, and in production it is reported and sent as it was, so the check
 * never takes a working route down.
 */
@Injectable()
export class ResponseContract implements NestInterceptor {
  private readonly logger = new Logger(ResponseContract.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const contract = this.reflector.get<RouteContract | undefined>(CONTRACT, context.getHandler());
    const schema = contract?.response;
    if (!schema) return next.handle();
    return next.handle().pipe(
      map((body: unknown) => {
        // Files, redirects and answers sent through the reply itself carry no body here; an error a
        // route answers itself, such as OAuth's, is not the success the schema describes.
        if (body === undefined || body === null || typeof body !== 'object') return body;
        if (context.switchToHttp().getResponse<FastifyReply>().statusCode >= 300) return body;
        const parsed = schema.safeParse(body);
        if (parsed.success) return parsed.data;
        const request = context.switchToHttp().getRequest<FastifyRequest>();
        const route = `${request.method} ${request.routeOptions?.url ?? ''}`;
        const issues = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        if (this.config.NODE_ENV !== 'production') {
          throw new Error(`${route} answered outside its contract: ${issues}`);
        }
        this.logger.error(`${route} answered outside its contract: ${issues}`);
        reportError(new Error('An answer outside its contract'), { route });
        return body;
      }),
    );
  }
}
