import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedDatabase } from '../../src/db/seed.js';
import { closeDb } from '../../src/db/connection.js';

describe('API Read Endpoints - Overview & Campaigns', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await seedDatabase();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('GET /api/overview returns KPIs, like-for-like aggregates, and open issues', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/overview?current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.dates).toBeDefined();
    expect(body.kpis).toBeDefined();
    expect(body.kpis.totalCampaigns).toBe(28);
    expect(body.kpis.activeCampaigns).toBeGreaterThanOrEqual(18);
    expect(body.kpis.spend).toBeGreaterThan(0);
    expect(body.kpis.impressions).toBeGreaterThan(0);
    expect(body.kpis.clicks).toBeGreaterThan(0);

    // Like-for-like aggregates
    expect(body.aggregates).toBeDefined();
    expect(body.aggregates.likeForLike).toBeDefined();
    expect(body.aggregates.likeForLike.excludedCampaigns.length).toBeGreaterThan(0);

    // Data quality indicators
    expect(body.dataQuality).toBeDefined();
    expect(body.dataQuality.hasDelayedGoogle).toBe(true);
    expect(body.dataQuality.hasFailedSync).toBe(true);

    // Open issues
    expect(body.issues).toBeDefined();
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0].severity).toBe('High'); // Sorted High first
  });

  it('GET /api/campaigns returns paginated and filtered campaigns with server-side comparison fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/campaigns?page=0&size=10&tab=all&current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.items).toHaveLength(10);
    expect(body.pagination.total).toBe(28);
    expect(body.pagination.totalPages).toBe(3);
    expect(body.tabCounts.all).toBe(28);
    expect(body.tabCounts.att).toBeGreaterThan(0);

    // Verify Summer AC Awareness item comparison fields by querying it directly
    const resSummer = await app.inject({
      method: 'GET',
      url: '/api/campaigns?q=Summer%20AC%20Awareness&current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07',
    });
    const summerBody = resSummer.json();
    const summer = summerBody.items.find((c: any) => c.name === 'Summer AC Awareness');
    expect(summer).toBeDefined();
    expect(summer.current.ctr).toBeCloseTo(2.6, 2);
    expect(summer.previous.ctr).toBeCloseTo(3.5, 2);
    expect(summer.changes.ctr.percentagePoints).toBeCloseTo(-0.9, 2);
    expect(summer.changes.ctr.relativePct).toBeCloseTo(-25.7, 1);
  });

  it('GET /api/campaigns filters by tab=att (Needs attention)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/campaigns?tab=att&current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.length).toBeGreaterThan(0);
    // Every item in att tab must either be unreliable or have a significant metric decline
    for (const item of body.items) {
      const isUnreliable = !item.reliability.isReliable;
      const isDecliningCtr = item.changes.ctr.relativePct != null && item.changes.ctr.relativePct <= -20;
      const isSpikingCpc = item.changes.cpc.relativePct != null && item.changes.cpc.relativePct >= 30;
      expect(isUnreliable || isDecliningCtr || isSpikingCpc).toBe(true);
    }
  });

  it('GET /api/campaigns filters by platform and search query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/campaigns?plat=Google&q=Search',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    for (const item of body.items) {
      expect(item.platform).toBe('Google');
      expect((item.name + item.raw).toLowerCase()).toContain('search');
    }
  });

  it('serves the frontend index.html at GET / and OpenAPI docs at GET /docs', async () => {
    const resRoot = await app.inject({
      method: 'GET',
      url: '/',
    });
    expect(resRoot.statusCode).toBe(200);
    expect(resRoot.headers['content-type']).toContain('text/html');
    expect(resRoot.body).toContain('Vajra — Governance');

    const resDocs = await app.inject({
      method: 'GET',
      url: '/docs/',
    });
    expect(resDocs.statusCode).toBe(200);
    expect(resDocs.headers['content-type']).toContain('text/html');
  });
});
