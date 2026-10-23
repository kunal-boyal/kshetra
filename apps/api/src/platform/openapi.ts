import { ErrorResponse } from '@thelamp/shared';
import { z } from 'zod';
import type { RegisteredRoute } from './routes';

/**
 * The OpenAPI document (spec 11: "the OpenAPI document generated from the code is the detailed
 * contract"), built from the route registry and the shared zod schemas. Schemas named with
 * `.meta({ id })` become components; one whose input differs from its output, through defaults,
 * gets a second component for its input.
 */

type Json = Record<string, unknown>;
type Io = 'input' | 'output';

const REF = '#/$defs/';

function rewrite(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => rewrite(item, names));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      key === '$ref' && typeof inner === 'string' && inner.startsWith(REF)
        ? `#/components/schemas/${names.get(inner.slice(REF.length)) ?? inner.slice(REF.length)}`
        : rewrite(inner, names),
    ]),
  );
}

/** Collects the named schemas of every conversion as components, one name per distinct schema. */
class Components {
  readonly schemas: Record<string, Json> = {};
  private readonly raw = new Map<string, string>();

  convert(schema: z.ZodType, io: Io): Json {
    const converted = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io,
      unrepresentable: 'any',
    }) as Json & { $defs?: Record<string, Json> };
    const { $defs = {}, ...root } = converted;
    delete root.$schema;
    const names = new Map<string, string>();
    for (const [name, definition] of Object.entries($defs)) {
      names.set(name, this.claim(name, JSON.stringify(definition), io));
    }
    for (const [name, definition] of Object.entries($defs)) {
      this.schemas[names.get(name)!] = rewrite(definition, names) as Json;
    }
    return rewrite(root, names) as Json;
  }

  private claim(name: string, raw: string, io: Io): string {
    const candidates = [name, `${name}${io === 'input' ? 'Input' : 'Output'}`];
    for (let n = 2; candidates.length < 8; n += 1) candidates.push(`${candidates[1]}${n}`);
    for (const candidate of candidates) {
      const held = this.raw.get(candidate);
      if (held === raw) return candidate;
      if (held === undefined) {
        this.raw.set(candidate, raw);
        return candidate;
      }
    }
    throw new Error(`Too many variants of the schema ${name}.`);
  }
}

function parameters(
  components: Components,
  schema: z.ZodType | undefined,
  where: 'path' | 'query',
) {
  if (!schema) return [];
  const object = components.convert(schema, 'input') as {
    properties?: Record<string, Json>;
    required?: string[];
  };
  return Object.entries(object.properties ?? {}).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: where,
      required: where === 'path' || (object.required ?? []).includes(name),
      ...(typeof description === 'string' ? { description } : {}),
      schema: rest,
    };
  });
}

function access(route: RegisteredRoute) {
  const rule = route.access;
  if (!rule || rule.kind === 'public') return { security: [] };
  return {
    security: [{ accessToken: [] }],
    'x-access':
      rule.kind === 'signed_in'
        ? 'Anyone signed in to the tenant'
        : `${rule.kind === 'all' ? 'Every one' : 'Any one'} of: ${rule.permissions.join(', ')}`,
  };
}

/** "The Lamp API", from the product's display name (decision D1). */
export function apiTitle(name = 'The Lamp'): string {
  return `${name} API`;
}

/** The document for these routes, with paths and components in a stable order. */
export function buildOpenApi(routes: readonly RegisteredRoute[], title: string): Json {
  const components = new Components();
  const error = components.convert(ErrorResponse, 'output');
  // Responses first, so a schema's output keeps its plain name and its input takes the variant.
  const responses = new Map(
    routes.map((route) => [
      route.key,
      route.contract?.response ? components.convert(route.contract.response, 'output') : undefined,
    ]),
  );
  const paths: Record<string, Record<string, Json>> = {};
  for (const route of routes) {
    const contract = route.contract;
    if (!contract) throw new Error(`${route.handler} (${route.key}) declares no @Contract.`);
    const path = route.path.replace(/:(\w+)/g, '{$1}');
    const response = responses.get(route.key);
    const headers = [
      ...(contract.idempotencyKey
        ? [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: true,
              description: 'A new random value for each change; a repeat returns the first result',
              schema: { type: 'string', minLength: 1, maxLength: 200 },
            },
          ]
        : []),
      ...(contract.headers ?? []).map((header) => ({
        name: header.name,
        in: 'header',
        required: false,
        description: header.description,
        schema: { type: 'string' },
      })),
    ];
    (paths[path] ??= {})[route.method.toLowerCase()] = {
      operationId: route.handler,
      summary: contract.summary,
      tags: [contract.tag],
      ...access(route),
      parameters: [
        ...parameters(components, contract.params, 'path'),
        ...parameters(components, contract.query, 'query'),
        ...headers,
      ],
      ...(contract.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: components.convert(contract.body, 'input') },
              },
            },
          }
        : {}),
      responses: {
        [String(route.status)]: response
          ? { description: 'Success', content: { 'application/json': { schema: response } } }
          : { description: 'Success, with no body' },
        ...Object.fromEntries(
          (contract.also ?? []).map((other) => [
            String(other.status),
            { description: other.description },
          ]),
        ),
        default: {
          description: 'An error in the format of spec 11.1, its code from spec 11.4',
          content: { 'application/json': { schema: error } },
        },
      },
    };
  }
  const sorted = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  return {
    openapi: '3.1.0',
    info: {
      title,
      version: '1',
      description:
        "Generated from the route registry by `pnpm openapi`. Paths under /auth/v1 belong to the directory; the rest to the tenant's cell (spec 9.3).",
    },
    paths: sorted(paths),
    components: {
      schemas: sorted(components.schemas),
      securitySchemes: {
        accessToken: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  };
}
