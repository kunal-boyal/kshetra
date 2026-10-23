// Location batches (spec 14.4): every device sends its points once a minute while on duty.
// Target: 20,000 devices in a cell; a batch answers within 300 ms at p95 (spec 3.2).
//   k6 run -e DEVICES=200 -e DURATION=10m tools/k6/locations.js
import { check, sleep } from 'k6';
import http from 'k6/http';
import { API, as, fieldSession, nearDelhi, onShift, uuid } from './lib.js';

const POINTS = Number(__ENV.POINTS || 1);

export const options = {
  scenarios: {
    devices: {
      executor: 'constant-vus',
      vus: Number(__ENV.DEVICES || 10),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    'http_req_duration{name:location batch}': ['p(95)<300'],
    'checks{check:every point accepted}': ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const { accessToken } = fieldSession();
  const shiftId = onShift(accessToken);
  const now = Date.now();
  const points = Array.from({ length: POINTS }, (_, index) => ({
    id: uuid(),
    shiftId,
    capturedAt: new Date(now - (POINTS - index) * 1000).toISOString(),
    location: nearDelhi(),
    accuracy: 10,
    mocked: false,
    source: 'background',
    battery: 80,
  }));
  const response = http.post(
    `${API}/v1/locations/batch`,
    JSON.stringify({ points }),
    as(accessToken, 'location batch'),
  );
  check(response, {
    'batch answered': (r) => r.status === 200,
    'every point accepted': (r) => r.status === 200 && r.json('rejected').length === 0,
  });
  sleep(60);
}
