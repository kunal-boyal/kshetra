import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apiControllers } from '../app.module';
import { apiTitle, buildOpenApi } from './openapi';
import { routeRegistry } from './routes';

const routes = routeRegistry(apiControllers());

describe('the route registry', () => {
  it('finds every route, each with an access rule and a contract', () => {
    expect(routes.length).toBeGreaterThan(25);
    expect(new Set(routes.map((route) => route.key)).size).toBe(routes.length);
    for (const route of routes) {
      expect(route.access, `${route.handler} declares who may call it`).toBeDefined();
      expect(route.contract, `${route.handler} declares its @Contract`).toBeDefined();
    }
  });

  it('describes path parameters, and a body for every answer but 204', () => {
    for (const route of routes) {
      const contract = route.contract!;
      expect(Boolean(contract.params), `${route.key} describes its path parameters`).toBe(
        route.path.includes(':'),
      );
      expect(Boolean(contract.response), `${route.key} describes its answer`).toBe(
        route.status !== 204,
      );
    }
  });
});

describe('the OpenAPI document', () => {
  const document = buildOpenApi(routes, apiTitle());

  it('is current: run `pnpm openapi` after changing a route or its schemas', () => {
    const committed = JSON.parse(
      readFileSync(new URL('../../openapi.json', import.meta.url), 'utf8'),
    ) as unknown;
    expect(committed).toEqual(document);
  });

  it('points every reference at a component it holds', () => {
    const text = JSON.stringify(document);
    const components = (document.components as { schemas: Record<string, unknown> }).schemas;
    const references = [...text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
      ([, name]) => name!,
    );
    expect(references.length).toBeGreaterThan(0);
    for (const name of references) expect(components, name).toHaveProperty(name);
    expect(text).not.toContain('#/$defs/');
  });
});
