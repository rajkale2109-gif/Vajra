import { buildApp } from './app.js';
import { config } from '../config/index.js';
import { seedDatabase } from '../db/seed.js';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';

async function start() {
  try {
    const { db } = await getDb();
    const existing = await db.select().from(schema.campaigns).limit(1);
    if (!existing.length) {
      console.log('Database empty on startup; seeding initial sample data...');
      await seedDatabase();
    }

    const app = await buildApp();
    const address = await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`Vajra Governance running at ${address}`);
    console.log(`Swagger OpenAPI documentation at ${address}/docs`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  start();
}
