// Form submissions (spec 14.4): 2,000 a minute across a cell, from people on duty, each answered
// within 300 ms at p95 (spec 3.2). The fixtures' `load_note` form has no photos, so this measures
// submissions rather than uploads.
//   k6 run -e RATE=2000 -e DURATION=10m tools/k6/submissions.js
import { check } from 'k6';
import http from 'k6/http';
import { API, as, fieldSession, fieldUsers, nearDelhi, onShift, uuid } from './lib.js';

export const options = {
  scenarios: {
    submissions: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 100),
      timeUnit: '1m',
      duration: __ENV.DURATION || '5m',
      // Each virtual user is one person, so there are never more than the fixtures hold.
      preAllocatedVUs: Math.min(fieldUsers.length, Number(__ENV.VUS || 50)),
      maxVUs: fieldUsers.length,
    },
  },
  thresholds: {
    'http_req_duration{name:submission}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const { accessToken } = fieldSession();
  onShift(accessToken);
  const now = new Date().toISOString();
  const response = http.post(
    `${API}/v1/submissions`,
    JSON.stringify({
      id: uuid(),
      form: { key: 'load_note', version: 1 },
      capturedAt: now,
      fix: { location: nearDelhi(), accuracy: 15, mocked: false, capturedAt: now },
      values: { note: 'Load test' },
      photos: [],
    }),
    as(accessToken, 'submission'),
  );
  check(response, { 'submission saved': (r) => r.status === 201 });
}
