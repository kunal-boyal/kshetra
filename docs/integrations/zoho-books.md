# Zoho Books

The first ERP connector (decision D129, BR-59). This page records what the connector relies on
in Zoho's API v3. It was read from Zoho's documentation on 2026-11-02, and is to be checked against
Kunal's trial organisation before a tenant uses it. Where the documentation was silent, it says so.

## OAuth

Source: <https://www.zoho.com/books/api/v3/oauth/>

- **Client.** The vendor registers one *Server-based Application* in Zoho's API console, with the
  portal's `/settings/erp/zoho` as its redirect, and enables multi-DC. The cell holds the client
  ID as `ZOHO_CLIENT_ID` and the secret as `ZOHO_CLIENT_SECRET`.
- **Agreeing.** The browser goes to `{accounts}/oauth/v2/auth` with:
  - `scope`;
  - `client_id`;
  - `response_type=code`;
  - `redirect_uri`;
  - `access_type=offline`;
  - `prompt=consent`;
  - `state`.

  Zoho sends the browser back with `code`, `state`, `location` and `accounts-server`, the accounts
  server of the data centre where the person's account lives.
- **Tokens.**
  - A code is spent at `{accounts-server}/oauth/v2/token`, with every parameter in the query string.
  - The answer holds `access_token` (an hour), `refresh_token` and `api_domain`.
  - A code is good for two minutes, once.
  - Refresh tokens don't expire until revoked. A person may hold 20; a 21st ends the oldest.
  - Ten access tokens can be made from a refresh token in ten minutes, so the worker keeps each for
    its hour.
  - Revoking is `POST {accounts-server}/oauth/v2/token/revoke?token=…`.
- **Calls.** Every call carries `Authorization: Zoho-oauthtoken …` and `organization_id`.
  `GET /books/v3/organizations` lists the person's organisations without one.

## Data centres

Source: <https://www.zoho.com/books/api/v3/introduction/>

The connector accepts only these hosts, HTTPS on 443 (`ZOHO_REGIONS`, `zohoHostIssue()`):

| Region | Accounts server | API domain |
|---|---|---|
| India | `accounts.zoho.in` | `www.zohoapis.in` |
| United States | `accounts.zoho.com` | `www.zohoapis.com` |
| Europe | `accounts.zoho.eu` | `www.zohoapis.eu` |
| Australia | `accounts.zoho.com.au` | `www.zohoapis.com.au` |
| Japan | `accounts.zoho.jp` | `www.zohoapis.jp` |
| Canada | `accounts.zohocloud.ca` | `www.zohoapis.ca` |
| China | `accounts.zoho.com.cn` | `www.zohoapis.com.cn` |
| Saudi Arabia | `accounts.zoho.sa` | `www.zohoapis.sa` |
| United Arab Emirates | `accounts.zoho.ae` | `www.zohoapis.ae` |

Zoho's pages give the API domains and show accounts servers by example. The accounts servers other
than `.com` and `.eu` follow Zoho's naming, and are to be confirmed when one is first used.

## Scopes

`ZohoBooks.contacts.READ`, `ZohoBooks.settings.READ` (items, price books and organisations sit
under settings), `ZohoBooks.invoices.READ`, `ZohoBooks.customerpayments.READ`,
`ZohoBooks.salesorders.CREATE` and `ZohoBooks.salesorders.READ`.

## Limits

Source: <https://www.zoho.com/books/api/v3/introduction/#api-call-limit>

- **Per minute:** 100 calls an organisation. The connector paces at 90.
- **Per day, by plan:**

  | Plan | Calls a day |
  |---|---|
  | Free | 1,000 |
  | Standard | 2,000 |
  | Professional | 5,000 |
  | Premium, Elite and Ultimate | 10,000 |

  The connection's `dailyCalls` setting holds the plan's figure, and a run stops with a tenth of it
  left.
- **Concurrent:** 5 on the free plan, 10 on paid plans. A run makes one call at a time.
- **Over a limit:** every limit answers HTTP 429. The run stops as `rate_limited` and the next carries
  on.

On the free plan, a first run over thousands of customers reads each customer's own page and may
take a few days of runs. Later runs read only what Zoho changed.

## What the connector reads

| Records | Call | Notes |
|---|---|---|
| Customers | `GET /contacts?contact_type=customer`, then `GET /contacts/{id}` for each new or changed one | The list leaves out the billing address and custom fields. A customer is new or changed when `last_modified_time` differs from the last run's. |
| Items | `GET /items` | Read in full each run; unchanged rows aren't written. |
| Price books | `GET /pricebooks/{id}` for each book the mappings name | Only `per_item` sales books, from `pricebook_items[].pricebook_rate`. |
| Invoices | `GET /invoices?date_start=…` | The last `invoiceDays`. |
| Payments | `GET /customerpayments?date_start=…` | As for invoices. `invoice_numbers` names what each settles. |

Lists page with `page` and `per_page` (200), and `page_context.has_more_page` says when another page
follows (<https://www.zoho.com/books/api/v3/pagination/>).

The documentation doesn't say that lists can be filtered by last change. That is why customers are
compared by `last_modified_time`, and everything else by the fingerprint of the row it makes.

**To confirm against the trial organisation:**

- that the invoice and payment lists take `date_start`;
- that the payment list carries `invoice_numbers`;
- that the item list carries `sku`, `unit`, `tax_percentage` and `group_name`.

## Sales orders (pull request 2)

Source: <https://www.zoho.com/books/api/v3/sales-order/>

- **Creating:** `POST /salesorders` takes:
  - `customer_id`;
  - `date`;
  - `reference_number`, our order number;
  - `line_items[]` with `item_id`, `quantity` and `rate`.
- **No duplicates:** Zoho documents no idempotency key. The connector looks for its reference with
  `GET /salesorders?reference_number=…` before creating, so a lost answer never makes a second
  order.
