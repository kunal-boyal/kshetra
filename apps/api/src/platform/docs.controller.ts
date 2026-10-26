import { existsSync, readFileSync } from 'node:fs';
import { Controller, Get, Header, Inject } from '@nestjs/common';
import type { Config } from '../config';
import { Public } from './auth';
import { apiTitle, buildOpenApi } from './openapi';
import { Contract, type RegisteredRoute } from './routes';
import { CONFIG } from './tokens';

/** Every route the API serves, for its documentation; the app module provides them. */
export const API_ROUTES = Symbol('API_ROUTES');

/**
 * Scalar's browser bundle (decision D94): copied beside the API's own bundle when it is built, or
 * read from the package while developing and testing.
 */
const SCALAR_FILES = [
  new URL('./docs/standalone.js', import.meta.url),
  new URL('../../node_modules/@scalar/api-reference/dist/browser/standalone.js', import.meta.url),
];

/** The page: Scalar's reference over our own document, with no fonts or proxies from elsewhere. */
const page = (title: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="/v1/docs/scalar.js"></script>
    <script src="/v1/docs/start.js"></script>
  </body>
</html>
`;

/** What starts the reference, served as a file so the page's policy needs no inline script. */
const START = `Scalar.createApiReference('#app', {
  url: '/v1/openapi.json',
  withDefaultFonts: false,
  hideDownloadButton: false,
  servers: [{ url: window.location.origin }],
});
`;

/**
 * The reference page's own Content-Security-Policy (decision D101): its scripts from here, its
 * document from here, and Scalar's inline styles; every other API answer allows nothing.
 */
export const DOCS_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * The API's own documentation (spec M20, decision D94): the OpenAPI document built from the routes
 * the API serves, and an interactive reference for integrators, at `/v1/docs`. Public, as they
 * describe the API, not any tenant's data.
 */
@Public()
@Controller('v1')
export class DocsController {
  private document: string | undefined;
  private scalar: Buffer | undefined;

  constructor(
    @Inject(API_ROUTES) private readonly routes: readonly RegisteredRoute[],
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Get('openapi.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Contract({ tag: 'Documentation', summary: 'The OpenAPI document', file: 'application/json' })
  openapi(): string {
    this.document ??= JSON.stringify(buildOpenApi(this.routes, apiTitle(this.config.PRODUCT_NAME)));
    return this.document;
  }

  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Content-Security-Policy', DOCS_POLICY)
  @Contract({ tag: 'Documentation', summary: 'The interactive API reference', file: 'text/html' })
  docs(): string {
    return page(`${apiTitle(this.config.PRODUCT_NAME)} reference`);
  }

  @Get('docs/scalar.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=86400')
  @Contract({
    tag: 'Documentation',
    summary: 'The reference’s script',
    file: 'text/javascript',
  })
  script(): Buffer {
    if (!this.scalar) {
      const found = SCALAR_FILES.find((file) => existsSync(file));
      if (!found) throw new Error('The API reference’s script is missing from this build.');
      this.scalar = readFileSync(found);
    }
    return this.scalar;
  }

  @Get('docs/start.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @Contract({ tag: 'Documentation', summary: 'What starts the reference', file: 'text/javascript' })
  start(): string {
    return START;
  }
}
