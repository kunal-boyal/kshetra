# Load tests

k6 scripts for the loads in spec 14.4 (decision D68). They run against a cell, local or staging, with sessions from the fixture generator, which makes a fictional tenant whose people are already signed in on their own devices.

```bash
docker compose up -d && pnpm dev                       # the API, its worker and scheduler; it builds the generator too
pnpm --filter @kshetra/api load:fixtures --users 200   # writes tools/k6/.fixtures/local.json
k6 run -e DEVICES=200 -e DURATION=10m tools/k6/locations.js
```

A run spends the fixtures' refresh tokens, as the app would, so make new fixtures before each run. Each set is a new tenant.

| Script | Load | Target (spec 3.2) |
|---|---|---|
| `locations.js` | `DEVICES` devices, each sending `POINTS` points a minute | A batch within 300 ms at p95 |
| `submissions.js` | `RATE` form submissions a minute | Within 300 ms at p95 |
| `dashboard.js` | `VUS` managers reading their month | Within 1.5 s at p95 |
| `exports.js` | One month's export, waited for | Ready within 10 minutes |

- Each virtual user is one person, as a refresh token works once: use as many fixture users as virtual users. The manager's scripts spend the manager's token once, in `setup()`, and share the access token, which lasts 15 minutes.
- Locally, rate limits and a laptop's limits stop well short of the spec's 20,000 devices and 2,000 submissions a minute. Those runs belong to staging, from a machine in the same region (step 17c), with fixtures made there.
- Set `API_URL` for another cell and `FIXTURES` for another fixtures file. The fixtures hold live sessions: they are git-ignored, and never leave the machine.
