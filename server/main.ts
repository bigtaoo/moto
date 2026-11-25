// The program the container runs. Everything it does is in index.ts, which the tests start on a port
// of their own -- so this file holds exactly what a test must not do: bind a port, and keep running.
import { collector } from './index.ts';

const PORT = Number(process.env.PORT) || 8787;
const DIR = process.env.COLLECT_DIR || 'data';

if (!process.env.EXPORT_TOKEN) {
  // Not fatal: collecting is the job, reading back is ours, and a collector that refuses to start
  // because of a missing export secret would lose a day of batches over a typo in an env file.
  console.warn('no EXPORT_TOKEN set: /export and /days will answer 404');
}

const server = collector({ dir: DIR, token: process.env.EXPORT_TOKEN });
server.listen(PORT, () => console.log(`collector on :${PORT}, writing ${DIR}`));

// Compose stops a container with SIGTERM and waits ten seconds before killing it. Closing the server
// lets the batches already in flight finish being written; appendFileSync means there is nothing else
// outstanding to flush.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
