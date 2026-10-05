# Decisions

This log records the decisions that shape the build. Section 16 of the specification seeded D1 to D16, and later decisions continue the numbering. To change a decision, add a new entry that supersedes it; never rewrite an old one.

On 5 October 2026 Kunal accepted every section 16 recommendation.

| ID | Decision | Outcome | Decided |
|---|---|---|---|
| D1 | Product name, domain and the legal entity that publishes the apps | Deferred, as recommended: decide before store listings and DLT registration. Until then the working name stays Kshetra, set once in `PRODUCT_SLUG`. | 2026-10-05, Kunal |
| D2 | Template and customer for the first pilot | The agri inputs template, whose rules are already proven. The pilot customer is still to be named. | 2026-10-05, Kunal |
| D3 | Seat prices and plan contents | Deferred, as recommended: set before phase 3. The product supports any values. | 2026-10-05, Kunal |
| D4 | Deployment models offered at launch | Shared SaaS only; dedicated cells on request from phase 3. | 2026-10-05, Kunal |
| D5 | Sign-in method for web users | Phone OTP for everyone, email OTP as an option, SSO for enterprise tenants. | 2026-10-05, Kunal |
| D6 | One app listing with tenant sign-in, or white-label apps | One listing; white-label only as a paid exception. | 2026-10-05, Kunal |
| D7 | Default geofence policy | Advisory, with the distance shown to reviewers. | 2026-10-05, Kunal |
| D8 | Who is ranked | One ranking group per designation; managers excluded by default. | 2026-10-05, Kunal |
| D9 | Default retention periods | Raw locations 35 days, trails 365 days, evidence photos 12 months, audit 3 years. | 2026-10-05, Kunal |
| D10 | Orders placed offline | Allowed, with `PRICE_CHANGED` handling on sync. | 2026-10-05, Kunal |
| D11 | Users without a phone number in imports | Phone required for anyone who signs in; phone-less records only for users who never sign in. | 2026-10-05, Kunal |
| D12 | WhatsApp access | Start with a Business Solution Provider; move to the Cloud API once volumes justify it. | 2026-10-05, Kunal |
| D13 | Map provider | Google Maps with per-tenant quotas; evaluate MapLibre with a commercial tile provider if map costs grow. | 2026-10-05, Kunal |
| D14 | Payroll scope | Inputs and provisional preview only; statutory payroll through integrations. | 2026-10-05, Kunal |
| D15 | Device binding for managers | On for mobile; web unbound. | 2026-10-05, Kunal |
| D16 | Attendance selfie and face match | Selfie capture as a tenant option in version 1; face match deferred pending a privacy review. | 2026-10-05, Kunal |
| D17 | Where the design system lives | `packages/design-tokens` holds the whole design system: tokens, brand book, component guides and logos. `ui-web` builds web components on it, and a new `packages/ui-mobile` builds shared mobile components. Spec 9.4 updated to match. | 2026-10-05, Kunal |
| D18 | Design system defaults | Default accent Jamun (#5b2b82), which tenants override. Noto Sans with Noto Sans Devanagari. Lucide icons. CSS reference components. Three themes: Light, Dark and Outdoor. | 2026-10-05, Kunal |
| D19 | How Outdoor is offered | Users switch Outdoor on themselves; it never turns on automatically. Onboarding doesn't suggest it until a midday-sun field test passes on two Android brands. | 2026-10-05, Kunal |
| D20 | Product logo | The Kshetra mark: a Jamun square with three geofence rings and a pin. A small-size SVG serves uses under 96 px, and a white glyph serves Android's tracking notification. All three files are in `packages/design-tokens/assets/Logos`. | 2026-10-05, Kunal |
| D21 | Local S3-compatible storage (spec 14.1 names MinIO) | MinIO, using Chainguard's free image (`cgr.dev/chainguard/minio`), because MinIO stopped publishing free container images on 23 October 2025. Chainguard builds it from MinIO's source. Its free tier offers only the `latest` tag. If that image is withdrawn, swap the compose service for SeaweedFS; application code reaches storage through the AWS SDK and doesn't change. | 2026-10-05, Kunal |
| D22 | API runtime and build | NestJS 12 on the Fastify adapter, for lower overhead at location-ingest peaks (spec 3.1). tsdown bundles the API, including the workspace packages, which therefore stay TypeScript source. Vitest's built-in compiler keeps NestJS's decorator metadata, so no SWC plugin is needed. | 2026-10-05, Kunal |
| D23 | Database roles and schemas | Three roles: `migrator` owns the schemas and runs migrations, `cell_app` is the API's role with no BYPASSRLS, and `directory_app` is the directory module's. Tenant data lives in the `cell` schema, and every table there has `tenant_id` and the `tenant_isolation` policy; an integration test fails if one doesn't. The `directory` schema admits `directory_app` only. Role names carry no product name, so a rename leaves them alone. | 2026-10-05, Kunal |
| D24 | An `INTERNAL` error code | Spec 11.4 lists no code for an unexpected server failure, so `INTERNAL` (HTTP 500) covers it. Its message never carries internal details. | 2026-10-05, Kunal |
