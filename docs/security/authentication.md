# Authentication and sessions

Every way in, how strong it is, the limits that protect it, and how long a session lasts (ASVS 5.0 V6.1.1, V6.1.2, V6.1.3, V6.3.4, V7.1.1, V7.1.2, V7.1.3, V7.6.1; decisions D29, D88, D91, D93, D94 and D101). The code is the source of the numbers below; change both together.

## Ways in

| Pathway | Who | Factors | Strength | Where |
|---|---|---|---|---|
| SMS code on a bound phone | Field people and managers in the app | A six-digit code sent to the person's registered number, then the phone's device key on every refresh | Two possessions: the SIM for the first sign-in, the bound device after it. A phone token never carries the permissions that change access (`SECOND_FACTOR_PERMISSIONS`) | `OtpService`, `SessionsService`, device binding (D29) |
| SMS code on the web | Portal users | The code alone | One factor, possession of the SIM. Enough only for people whose role changes nobody's access and who have no authenticator | `SessionsService` |
| SMS code and authenticator on the web | Anyone whose role holds a `SECOND_FACTOR_PERMISSIONS` permission, and anyone who has set an authenticator up | The code, then a TOTP code or a recovery code | Two factors: the SIM and the authenticator's seed | `SecondFactorService` (D91, D101) |
| Single sign-on | People of an organisation that set up OIDC or SAML, by a verified domain | The identity provider's sign-in; where the provider doesn't say it did multi-factor, admins and anyone with an authenticator also give our code | The provider's, at least two factors for admins | `SsoService` (D91, D101) |
| Demo codes | People of demo tenants on a demo cell | A fixed code for a named number | One weak factor, accepted because it opens only fictional demo tenants: a code works only while every tenant of its number is a demo tenant, and a live cell refuses demo mode | `DEMO_CODES` (D70) |
| Vendor staff | The vendor's people, in the console | Email, password, TOTP code | Two factors | `StaffService` (D88, D101) |
| Staff setup link | A newly invited or reset staff member | A single-use link, by email, then a new password and authenticator | Possession of the mailbox, once; it leads straight to setting both factors | `pnpm invite-staff`, `POST /platform/v1/staff/{id}/reset` |
| Vendor support entry | Staff entering a tenant under a grant | A signed-in staff session, an approved grant, and an entry link that lasts 60 seconds and works once | The staff member's two factors, bounded by the tenant's grant | `SupportService` (D93) |
| API clients | Tenants' integrations | Client ID and secret, OAuth client credentials | One factor, a 256-bit random secret kept as a digest. Scoped, rate limited, and unable to give roles that change access | `ApiClientsService`, `oauth.controller.ts` (D94) |
| Choosing a tenant | Someone who belongs to several organisations | A ticket from the code step, five minutes, single use | Carries the strength of the sign-in that made it | `SessionsService.selectTenant()` |
| Step-up | A signed-in session about to change a phone, an email, an authenticator or SSO | A fresh authenticator code, good for ten minutes (`STEP_UP_SECONDS`) | Re-proves the second factor | `@StepUp()` (D101) |

Every pathway ends in the same tokens: an ES256 access token of 15 minutes naming its session (`sid`), and a refresh token that rotates on every use, whose reuse ends the whole session. Sign-ins and failures are logged as security events with their factors (docs/security/logging.md).

### SMS codes, an accepted risk

SMS is a restricted authenticator: a number can be taken over by a SIM swap, and codes can be read off a lost or shared phone. It stays the primary factor because field people sign in with nothing but a phone, often a shared or low-end one, and an app-based factor for them would cost more sign-ins than it would stop. What limits the risk: phones are bound to one device after the first code, so a stolen code alone signs nobody in on another phone once the person has signed in; nothing that changes access can be done from a phone; every role that changes access must add an authenticator on the web, and anyone else may; the codes are short-lived and counted (below); and Sign-in security tells people what an SMS code can't protect against. Accepted by Kunal on 2026-10-26 (decision D101).

## Limits and lockout

| What | Limit | Counted by | When exceeded |
|---|---|---|---|
| SMS codes requested | 3 a number in 10 minutes; 20 an address an hour | `OTP_LIMITS` | `RATE_LIMITED` |
| SMS codes checked | 30 an address an hour; 5 guesses a code | `OTP_LIMITS`, the challenge | The code is spent |
| Wrong SMS codes | 10 a number an hour, 20 a day, across its codes and addresses | `OTP_LIMITS.wrongCodesPerNumberHour`, `…Day` | `RATE_LIMITED` for that number |
| Wrong authenticator or recovery codes | 5 a sign-in ticket; 5 in 10 minutes when managing one's own authenticator | `SECOND_FACTOR_TRIES` | The ticket ends; sign-in starts again with a new SMS code |
| Staff sign-in | 20 an address and 10 an email in 15 minutes; 10 wrong tries lock the account 15 minutes | `STAFF_LIMITS`, `LOCK` | The same answer as wrong details |
| Staff setup links | 20 an address an hour | `STAFF_LIMITS.setupsPerAddress` | `RATE_LIMITED` |
| OAuth tokens | 30 a client and 120 an address a minute | `oauth.controller.ts` | `RATE_LIMITED` |
| SSO | 60 lookups and 30 starts an address in 10 minutes | `sso.controller.ts` | `RATE_LIMITED` |
| Requests, signed in | 600 a person, support grant or staff member a minute (`USER_REQUESTS_PER_MINUTE`); an API client's `limits.apiPerMinute` or 300; the whole tenant's `limits.requestsPerMinute` when its plan sets one | The auth guard | `RATE_LIMITED` |
| Sign-in at the edge | 300 an address in 5 minutes on sign-in paths, at CloudFront by the viewer and at the load balancer for requests that come straight to it | The WAF (docs/runbooks/web-firewall.md) | Blocked at the edge |

Addresses are the caller's as `clientAddress()` reads them (decision D101), never a header the caller writes.

**Malicious lockout.** No limit locks a person out of a session they already hold: limits apply to signing in, and sessions keep refreshing. Only wrong answers count against a number or a staff account, never correct sign-ins. What an attacker can still do, and why it is accepted:
- With a person's number, an attacker can spend its wrong-code allowance and stop new sign-ins on that number for up to an hour, or a day after twenty wrong codes. Phones stay signed in for 30 days, so field work goes on; the WAF and the per-address limits slow anyone doing it at scale, and OTP volume is watched per tenant (spec 13.2).
- With a staff email, an attacker can lock that account for 15 minutes at a time. Staff emails aren't published, and a locked account answers as wrong details do, so the lock tells nobody the email exists. A platform admin can always reset the account.

## Passwords

Only vendor staff have passwords. A new password is 12 to 200 characters, any characters, no composition rules, never truncated, and refused when it:
- contains a context word (`passwordWords()` in `@thelamp/shared`, compared in lower case with spaces and punctuation removed): the product's name and slug (`PRODUCT_NAME`, `PRODUCT_SLUG`), the local part of the staff member's email, and each part of their name of four letters or more;
- appears in Have I Been Pwned's breached passwords, which also covers the most common passwords (`BreachedPasswords`, required in production; when the service can't be reached in three seconds the password is let through with a warning in the log).

Passwords are hashed with scrypt (docs/security/keys-and-crypto.md). Staff change theirs at Your account with the current password and a fresh code; that ends every other session. Someone who forgot theirs, or lost their authenticator, is reset by a platform admin, which removes both, ends their sessions and sends a new setup link. Nobody resets themselves.

## Sessions

| Session | Access token | Ends when unused for | Ends at the latest | Notes |
|---|---|---|---|---|
| Phone | 15 minutes | 30 days | 90 days after sign-in | Bound to the device; an admin can reset the device |
| Web | 15 minutes | 12 hours | 7 days after sign-in | The refresh token is in an httpOnly `__Host-` cookie, the access token in memory |
| Web through SSO | 15 minutes | 12 hours | 12 hours after sign-in | So the identity provider decides again at least daily |
| Vendor support | 15 minutes | The grant's end | The grant's end | Ends when the tenant revokes the grant |
| Console | 15 minutes | 12 hours | 12 hours after sign-in | |
| API client | 15 minutes, no refresh | | | A new token from the client's credentials |

The limits are `SESSION_LIMITS` in `packages/shared/src/sessions.ts`, measured from when the session began, so refreshing never extends the absolute limit and switching tenant keeps the first sign-in's clock. NIST SP 800-63B asks for reauthentication within 12 hours of use at AAL2 and allows 30 days at AAL1; the web follows the first, and phones, which only reach AAL1 actions, the second, with a 90-day ceiling.

**Ending sessions.** A session ends when its person signs out, ends it from Sign-in security's list, reuses a spent refresh token, switches tenant, or has an authenticator reset; its access tokens stop at once (`EndedSessions`). An admin with `user.sign_out_all` can end every session of one person, or of everyone in the organisation but themselves. Suspending a person, a device or a tenant stops their tokens on the next request. Changing a staff password ends every other staff session.

**How many at once.** Not limited. A person may be signed in on any number of browsers and one bound phone; every session is listed at Sign-in security with where and when it signed in and was last used, and any can be ended (decision D101).

**SSO and the identity provider.** Signing out of the identity provider doesn't sign anyone out here, as no back-channel logout is offered. Instead an SSO session lasts at most 12 hours, so someone disabled at the provider can't continue past that day, and an admin who needs it sooner ends the person's sessions or suspends them. People are bound to the provider's issuer and subject at their first SSO sign-in, so a changed or reused email at the provider moves nobody.
