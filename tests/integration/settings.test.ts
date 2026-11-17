import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedDatabase } from '../../src/db/seed.js';
import { closeDb } from '../../src/db/connection.js';

describe('Settings API', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    await seedDatabase();
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('returns profile, connections and preferences', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/settings' })).json();
    expect(body.account.name).toBeTruthy();
    expect(body.connections.map((c: any) => c.platform).sort()).toEqual(['Google', 'Meta']);
    expect(body.preferences.minImpressionsThreshold).toBe(1000);
  });

  it('saves a partial update and persists it', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/settings', payload: { dailySummaryEmail: false, minImpressionsThreshold: 2500 } });
    expect(put.statusCode).toBe(200);
    const prefs = (await app.inject({ method: 'GET', url: '/api/settings' })).json().preferences;
    expect(prefs.dailySummaryEmail).toBe(false);
    expect(prefs.minImpressionsThreshold).toBe(2500);
    expect(prefs.notifyImmediateHigh).toBe(true);
  });

  it('rejects invalid values', async () => {
    const bad = await app.inject({ method: 'PUT', url: '/api/settings', payload: { minImpressionsThreshold: -5 } });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({ method: 'PUT', url: '/api/settings', payload: {} });
    expect(empty.statusCode).toBe(400);
  });
});
