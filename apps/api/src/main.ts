import { createApp } from './app';
import { createPool, migrate } from './db';

async function start(): Promise<void> {
  const pool = createPool();
  await migrate(pool);

  const port = process.env['PORT'] || 3333;
  const server = createApp(pool).listen(port, () => {
    console.log(`Listening at http://localhost:${port}/api`);
  });
  server.on('error', console.error);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
