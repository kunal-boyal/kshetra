import { RequestMethod, SetMetadata, type Type } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { z } from 'zod';
import { type AccessRule, accessRuleOf } from './auth';

/**
 * What a route takes and gives (spec 11). The route registry reads it, and the OpenAPI document
 * and the cross-tenant contract test are built from the registry.
 */
export interface RouteContract {
  /** A short, verb-first summary, such as "List users". */
  summary: string;
  /** The route's group in the document, such as "People". */
  tag: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** The body of a success; leave it out when the route answers 204 with none. */
  response?: z.ZodType;
  /** Creates and actions without a client-generated ID take an `Idempotency-Key` (BR-46). */
  idempotencyKey?: boolean;
  /** Request headers beyond the usual ones, such as `If-None-Match`. */
  headers?: readonly { name: string; description: string }[];
  /** Answers besides success that clients act on, such as 304. */
  also?: readonly { status: number; description: string }[];
}

const CONTRACT = 'route-contract';

/** Declares a route's contract; every route has one, and a test fails for any without. */
export const Contract = (contract: RouteContract) => SetMetadata(CONTRACT, contract);

export interface RegisteredRoute {
  /** `METHOD /path`, the name fixtures and the document use: `GET /v1/users/:id`. */
  key: string;
  method: string;
  path: string;
  /** Where the handler lives, for messages: `UsersController.get`. */
  handler: string;
  /** The status a success answers with. */
  status: number;
  access: AccessRule | undefined;
  contract: RouteContract | undefined;
}

function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((part) => (typeof part === 'string' ? part.split('/') : []))
    .filter(Boolean);
  return `/${segments.join('/')}`;
}

/** The controllers a module declares, and those of every module it imports, once each. */
export function controllersOf(modules: readonly unknown[]): Type[] {
  const found = new Set<Type>();
  const seen = new Set<unknown>();
  const visit = (module: unknown) => {
    if (!module || seen.has(module)) return;
    seen.add(module);
    // A dynamic module carries its controllers and imports on the object it returns.
    const target = (module as { module?: unknown }).module ?? module;
    const own = (key: string): unknown[] => [
      ...((Reflect.getMetadata(key, target as object) as unknown[] | undefined) ?? []),
      ...(((module as Record<string, unknown>)[key] as unknown[] | undefined) ?? []),
    ];
    for (const controller of own(MODULE_METADATA.CONTROLLERS)) found.add(controller as Type);
    for (const imported of own(MODULE_METADATA.IMPORTS)) visit(imported);
  };
  modules.forEach(visit);
  return [...found];
}

/**
 * Every route of these controllers, read from their decorators without starting the app: method,
 * path, success status, access rule and contract.
 */
export function routeRegistry(controllers: readonly Type[]): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  for (const controller of controllers) {
    const base = Reflect.getMetadata(PATH_METADATA, controller) as string | undefined;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor') continue;
      // Reading a getter would run it; routes are plain methods.
      const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value as unknown;
      if (typeof handler !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
      if (path === undefined) continue;
      const method =
        RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'GET';
      const full = joinPath(base, path);
      routes.push({
        key: `${method} ${full}`,
        method,
        path: full,
        handler: `${controller.name}.${name}`,
        status:
          (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
          (method === 'POST' ? 201 : 200),
        access: accessRuleOf(handler, controller),
        contract: Reflect.getMetadata(CONTRACT, handler) as RouteContract | undefined,
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}
