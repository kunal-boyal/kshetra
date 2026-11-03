# Connect your systems with API clients and webhooks

| | |
|---|---|
| **Who** | Admin (`api_client.manage` for API clients, `webhook.manage` for webhooks) |
| **Where** | Web portal › **Settings** › **Developers** › **API and webhooks** |
| **Module** | **Integrations** |
| **Related** | [Connect your books](erp-connections.md) |

API clients let your other systems, such as an ERP or an HR system, call the API with credentials of their own. Webhooks tell those systems the moment something happens here. Make a client for each system, give it only the scopes it needs, and hand its secret straight to whoever sets that system up.

## Before you start

- The **Integrations** module is on. While it is off, **Developers** isn't in the menu, client tokens are refused and no webhook messages are made or sent. Clients and webhooks are kept for when it is on again.
- In the default templates only the Admin role holds `api_client.manage` and `webhook.manage`.
- Have a safe place ready for the secret. It is shown once.

## Steps

### Add an API client

1. Open **Settings** › **Developers** › **API and webhooks**. Select **Create a key** to jump to the form, or scroll to **New API client**.
2. Fill in **Name**: what the client is, such as "Tally ERP".
3. Under **Scopes**, tick **Read** or **Write** for each resource the client needs. Write includes read. Give a client only what it needs:

   | Resource | What it reaches | Read | Write |
   |---|---|---|---|
   | **People** | People, the org chart and people's histories | yes | yes |
   | **Territories** | The territory tree; every client can read it | | yes |
   | **Accounts** (your word for accounts) | Accounts and their imports | yes | yes |
   | **Catalogue** | Items and price lists | yes | yes |
   | **Orders** (your word for orders) | Orders, and recording deliveries | yes | yes |
   | **Submissions** | Form submissions, with the people and accounts they belong to | yes | |
   | **Attendance** | Attendance days and shifts, with the people they belong to | yes | |
   | **Finance** | Balances, ageing and statement entries, and the collections the field takes | yes | yes |
   | **Targets** (your word for targets) | Targets by person and month (write also records forecasts) | yes | yes |
   | **Metric values** | Values of external metrics, such as secondary sales (write also records sell-through statements) | | yes |
   | **Stock** | Stock levels and movements at accounts, and loading them from their own systems | yes | yes |
   | **Reports** | Reports and their exports | yes | |
   | **Audit log** | Every change made in the organisation | yes | |

4. Select **Add API client**.
5. A panel shows **Credentials for** the client, with its **Client ID** and **Client secret**, each with **Copy**. Copy the secret now: it won't be shown again. Select **Done**.
6. Give the integrator the **Token URL**, **API address** and **API reference** link from **Connecting**, with the client ID and secret.

### Look after API clients

7. **Your API clients** lists each client's **Name**, **Scopes**, when it was **Last used** (or **Never**) and its **Status**.
8. If a secret may have leaked or is lost, select **New secret** and confirm. The old one and its tokens stop working at once; the new one shows once, as above.
9. To stop a client for good, select **Revoke** and confirm. It can't call the API again.

### Add a webhook

10. Under **New webhook**, fill in **Address** (where to post, such as `https://erp.example.com/hooks`) and, if you like, **Description** (which system receives it).
11. Tick the **Events** to send: **Person added**, **Person’s details changed**, **Person deactivated**, **Account added**, **Account changed**, **Account given to someone**, **Form submitted**, **Submission reviewed**, **Order placed**, **Order status changed**, **Collection recorded**, **Collection status changed** (account and order in your words).
12. Select **Add webhook**. A panel shows the **Signing secret**; copy it now, as it won't be shown again. Your system checks each message's `webhook-signature` header with it. Select **Done**.

### Look after webhooks

13. **Your webhooks** shows each address with **Active** or **Paused**, its health (**Healthy**, **Failing** or **Not tried yet**), its events, and its last try.
14. Select **Send a test** to post a test message. You see "Delivered: your system answered 200 in 120 ms." or "Not delivered:" with the reason.
15. **Change** edits the address, description or events; **Save webhook** keeps them.
16. **Pause** stops sending: nothing is sent, and what happens meanwhile isn't sent later. **Resume** starts again.
17. **New secret** signs messages with a new secret from now on, so update your system at once.
18. The **Delivery log** lists each try's **When**, **Event**, **Result**, how long it **Took**, which **Try** it was, and the **Message** state (**Trying again**, **Delivered** or **Given up**). Select **Send again** to queue a message once more.

Webhooks are paused, never deleted.

## What the system checks

- A client reaches the whole organisation, but only within its scopes; no person's data scope limits it. A client can give people any role except one that can change access (`canGrant()`).
- A webhook address must be HTTPS on port 443 to a public address, with no user name or password in it.
- Messages carry IDs, keys and statuses, never personal details; your system reads the rest through the API.
- A message not taken is tried again after 1, 5, 15, 60, 180, 360 and 720 minutes, for at most a day from the first try, then given up. A try waits 10 seconds for an answer; any 2xx answer counts as delivered, and a redirect counts as a failure.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| Choose at least one scope / Choose at least one event | Nothing was ticked. | Tick what the client or webhook needs. |
| Failing | The last try wasn't delivered. | Open the **Delivery log**; check the receiver is up and answers 2xx, then **Send again**. |
| A message under **Address**, such as "Use an https:// address" | The address isn't HTTPS on port 443 to a public server, or has a user name or password in it. | Use the receiver's public HTTPS address. |
| The integrator's token request fails | Wrong ID or secret, a revoked client, a scope it wasn't given, or **Integrations** is off. | Check the client's status and scopes; give it a **New secret** if the secret is in doubt. |
| You don't have access to this. | You hold neither `api_client.manage` nor `webhook.manage`. | Ask an admin. |

## For operators: the public API

What an integrator needs to know, in brief. The full reference is at **API reference** on the page.

- **Reference.** `GET /v1/docs` is the interactive reference and `GET /v1/openapi.json` the OpenAPI document, both built from the running routes, at the **API address**.
- Tokens: `POST /auth/v1/oauth/token` (the **Token URL**) with `grant_type=client_credentials`, sending the client ID and secret as HTTP Basic or as `client_id` and `client_secret`. It may ask for some of its scopes with `scope`. A token lasts an hour; ask for another with the credentials. Too many token requests answer `slow_down` with `Retry-After: 60`. While **Integrations** is off it answers `unauthorized_client`.
- **Calls.** Send the token as `Authorization: Bearer <token>` to the **API address**. A route the client's scopes don't cover answers `FORBIDDEN`.
- Limits: Each client may make the plan's requests a minute for API clients, or 300 a minute when the plan says nothing; the whole organisation is also held to its plan's limit, if it has one. Past a limit the API answers `RATE_LIMITED` with `Retry-After`; wait that long and try again.
- Bulk upserts: `POST /v1/bulk/users`, `accounts`, `items`, `ledger-entries`, `invoices`, `receipts`, `sell-through`, `stock-movements`, `stock-levels`, `forecasts` and `external-metrics` take JSON rows as the matching file import does. Each needs an `Idempotency-Key` header, so a resend applies once. Every row is checked; all are written or none, and problems come back as `IMPORT_ERRORS` at `rows.<index>.<field>`. `GET /v1/bulk/fields` lists the fields a target takes, custom fields included.
- Every write takes a client-generated ID or an `Idempotency-Key`; the same key with a different body answers `IDEMPOTENCY_CONFLICT`.
- Webhook signing follows Standard Webhooks: headers `webhook-id`, `webhook-timestamp` and `webhook-signature`. The signature is `v1,` and the base64 HMAC-SHA256, keyed with the base64-decoded secret after `whsec_`, over `<webhook-id>.<webhook-timestamp>.<body>`. Check it, and reject old timestamps; use `webhook-id` to ignore a message already handled, since delivery is at least once.
