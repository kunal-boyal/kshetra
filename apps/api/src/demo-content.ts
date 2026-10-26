// `node dist/demo-content.mjs --tenant <slug> [--days 26] [--seed 7]`: fills a new demo tenant with a
// few weeks of fictional work (decision D70). The simulated clock comes first, before any module
// reads the time. On the demo box: `infra/scripts/demo.sh content --tenant <slug>`.
import './demo/clock';
import { parseArgs } from 'node:util';
import { createCommandContext, report } from './context';
import { DemoContent } from './demo/content';

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    days: { type: 'string', default: '26' },
    seed: { type: 'string', default: '7' },
  },
});
const days = Number(values.days);
if (!values.tenant || !Number.isInteger(days) || days < 1 || days > 60) {
  console.error('Usage: demo-content --tenant <slug> [--days 1-60] [--seed <number>]');
  process.exit(1);
}

const { app } = await createCommandContext();
try {
  const started = Date.now();
  const counts = await new DemoContent(app, {
    slug: values.tenant,
    days,
    seed: Number(values.seed) || 7,
    log: (line) => console.log(line),
  }).run();
  console.log(
    `Done: ${counts.shifts} shifts, ${counts.visits} visits, ${counts.entries} entries, ${counts.photos} photos, ${counts.reviews} reviews, ${counts.proposals} proposals; ` +
      `${counts.orders} orders, ${counts.deliveries} delivered; ${counts.leave} leave requests, ${counts.fixes} fixed days, ` +
      `${counts.claims} claims, ${counts.paid} paid; ${counts.decisions} decisions.`,
  );
  void started;
} catch (error) {
  report(error);
} finally {
  await app.close();
}
