// The team dashboard (spec 14.4): a manager's month for a team of 1,000, within 1.5 s at p95
// (spec 3.2). Make the fixtures with --users 1000 for the full team. The virtual users share the
// manager's session, so keep runs under 14 minutes, before its access token expires.
//   k6 run -e VUS=10 -e DURATION=5m tools/k6/dashboard.js
import { check, sleep } from 'k6';
import http from 'k6/http';
import { API, as, managerToken, period } from './lib.js';

export const options = {
  scenarios: {
    managers: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 5),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    'http_req_duration{name:dashboard}': ['p(95)<1500'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  return { token: managerToken() };
}

export default function ({ token }) {
  const response = http.get(`${API}/v1/dashboard?period=${period}`, as(token, 'dashboard'));
  check(response, { 'dashboard answered': (r) => r.status === 200 });
  sleep(5);
}
