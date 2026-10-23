// A month's export (spec 14.4): the activity log of every person the manager sees, made on the
// exports queue and waited for. Run with fixtures of 5,000 users for the spec's month export.
//   k6 run -e REPORT=attendance_register tools/k6/exports.js
import { check, fail, sleep } from 'k6';
import http from 'k6/http';
import { Trend } from 'k6/metrics';
import { API, as, managerToken, period, uuid } from './lib.js';

const ready = new Trend('export_seconds', false);

export const options = {
  scenarios: {
    export: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30m' },
  },
  thresholds: {
    export_seconds: ['max<600'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  return { token: managerToken() };
}

export default function ({ token }) {
  const id = uuid();
  const started = Date.now();
  const asked = http.post(
    `${API}/v1/exports`,
    JSON.stringify({
      id,
      report: __ENV.REPORT || 'activity_log',
      filters: { period },
      format: __ENV.FORMAT || 'xlsx',
    }),
    as(token, 'export request'),
  );
  if (!check(asked, { 'export queued': (r) => r.status === 201 })) fail(asked.body);
  for (;;) {
    sleep(5);
    const status = http.get(`${API}/v1/exports/${id}`, as(token, 'export status'));
    const state = status.json('status');
    if (state === 'ready') break;
    if (state === 'failed' || state === 'expired') fail(`The export ${state}.`);
  }
  ready.add((Date.now() - started) / 1000);
}
