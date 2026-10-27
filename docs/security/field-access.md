# Field-level access

Which fields of a record a caller may read or change beyond the record itself (ASVS 5.0 V8.1.2, V8.2.3; decision D101). Who may reach a record at all is spec 4.2's roles and scopes with the permissions of Appendix E; this page covers the fields inside one.

## How it is enforced

- **Writes.** Every body is parsed with its route's zod schema, almost all `strictObject`, so a field the route doesn't take is refused rather than ignored. Fields computed by the server (prices, totals, statuses, days, scores, review outcomes) are never in a body schema, so a caller can't set them.
- **Reads.** Every answer is cut to its route's declared response schema by `ResponseContract` (`apps/api/src/platform/response-contract.ts`) before it leaves: a field a handler returns that the contract doesn't declare is dropped. Outside production an answer that doesn't fit its schema fails loudly, so a test catches it; in production it is reported to Sentry and logged, and the declared fields still go out.
- **Secrets are write-only.** A secret goes in and never comes back: answers carry whether one is set, never its value (below).

## Rules

| Record | Field | Who may read | Who may change | Where |
|---|---|---|---|---|
| Person | Role | Anyone who reaches the person | Holders of `user.manage`, and only to a role whose permissions they hold themselves (`canGrant()`); never their own | `UsersService` |
| Person | Status (active, suspended, left) | Same | `user.manage`; never their own. Seats are checked under the tenant's seat lock | `UsersService`, `Seats` |
| Person | Phone, email | Same | `user.manage`, with a step-up code from the last ten minutes, imports included; nobody changes their own, and phones never hold the permission | `UsersService.update()`, `requireStepUp()` |
| Person | Device binding | Managers in scope | `user.reset_device`; never their own device | `UsersService` |
| Person | Authenticator | Whether one is set: the person and admins | The person (with a current code to remove it); an admin with step-up to reset someone else's; never one's own reset | `SecondFactorService`, `UsersService` |
| Person | Sessions | The person, at Sign-in security | The person ends any; `user.sign_out_all` ends all of someone's, or everyone's | `SessionsService` |
| Tenant settings | `modulesOff` | Everyone, through the bundle | `module.manage` only, beyond `settings.manage` | `settings.controller.ts` |
| Tenant settings | Everything else | Everyone, through the bundle | `settings.manage` | `TenantConfigService` |
| SSO connection | Client secret, SAML private key and certificate | Whether set | `settings.manage` with step-up; a blank field keeps the saved value | `SsoService` (`redact()`) |
| API client | Secret | Shown once when made or rotated | `api_client.manage` | `ApiClientsService` |
| Webhook | Signing secret | Shown once when made or rotated | `webhook.manage` | `WebhooksService` |
| Order | Line prices, discounts, taxes, totals | Whoever reaches the order | Nobody: the server prices every line; a price the device showed otherwise is refused (`PRICE_CHANGED`) | `OrdersService.place()` |
| Order | Status, line decisions | Same | The approver, on the order's page; fulfilment through its own routes | `OrdersService.decide()` |
| Submission | Values, photos, location, flags | Whoever reaches it | Nobody after submitting: submissions are immutable | `SubmissionsService` |
| Submission | Review status | Same | Reviewers, never on their own work; auto-approval by rule | `ReviewService.record()` |
| Expense claim, leave request | Amounts, capped amounts, days | The person and approvers | Nobody: computed from the policy and calendar (`capClaim()`, `leaveDays()`) | `ExpenseClaimsService`, `LeaveRequestsService` |
| Targets | Values | The person and their reporting line | Planners for others, never for themselves; a locked set only after an unlock | `TargetsService` |
| Photo | The file | The capturer, and others in scope once checked; a rejected photo is shown to nobody, original included | Nobody: replaced only by a new photo | `PhotosService` |
| Audit entry | All | `audit.view` | Nobody: append-only | `AuditLog` |
| Any record | Anything | Vendor support under a read grant | Nobody: writes answer `SUPPORT_READ_ONLY` | `IamAccess` |
| Any record | Anything changing access | API clients | Never a role that can change access | `canGrant()` |

## Adding a field

A new field that only some callers should see or set gets a row here, and its rule goes in the service that owns the record, with a test. A field that must never reach some readers stays out of the route's response schema for them; `ResponseContract` then keeps it in.
