import { buildApp } from '../src/server/app.js';
import { seedDatabase } from '../src/db/seed.js';
import { getDb } from '../src/db/connection.js';
import * as schema from '../src/db/schema.js';

let appInstance: any = null;

export default async function handler(req: any, res: any) {
  if (!appInstance) {
    const { db } = await getDb();
    const existing = await db.select().from(schema.campaigns).limit(1);
    if (!existing.length) {
      await seedDatabase();
    }
    appInstance = await buildApp();
    await appInstance.ready();
  }
  appInstance.server.emit('request', req, res);
}
