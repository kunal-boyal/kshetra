// `pnpm dev`: runs the API, the worker and the scheduler together, which production runs as
// separate services (spec 9.4). tsdown stops and restarts all three after each rebuild.
import { spawn } from 'node:child_process';

const children = ['main', 'worker', 'scheduler'].map((entry) =>
  spawn(process.execPath, ['--env-file-if-exists=../../.env', `dist/${entry}.mjs`], {
    stdio: 'inherit',
  }),
);

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// When one stops, the others stop too, so a crash doesn't hide behind the others' output.
for (const child of children) child.on('exit', stop);
