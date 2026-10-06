import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiControllers } from './app.module';
import { apiTitle, buildOpenApi } from './platform/openapi';
import { routeRegistry } from './platform/routes';

/**
 * `pnpm openapi`: writes `apps/api/openapi.json` from the route registry. It reads the controllers'
 * decorators only, so it needs no database. A unit test fails when the file is out of date.
 */
const target = new URL('../openapi.json', import.meta.url);
const document = buildOpenApi(routeRegistry(apiControllers()), apiTitle(process.env.PRODUCT_SLUG));
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${fileURLToPath(target)}`);
