import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedDatabase } from '../../src/db/seed.js';
import { closeDb } from '../../src/db/connection.js';

const Q = 'current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07';

describe('GET /api/timeseries (powers "View graph")', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await seedDatabase();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  it('returns aligned daily series for current and previous period', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/timeseries?${Q}` });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.days).toHaveLength(7);
    expect(b.total.current).toHaveLength(7);
    expect(b.total.previous).toHaveLength(7);
    expect(b.total.current[0].date).toBe('2026-11-08');
    expect(b.total.previous[0].date).toBe('2026-11-01');
    expect(b.byPlatform.map((p: any) => p.key).sort()).toEqual(['Google', 'Meta']);
    expect(b.byCampaign.length).toBeGreaterThan(1);
  });

  it('daily series reconcile with the overview KPI totals', async () => {
    const ts = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}` })).json();
    const ov = (await app.inject({ method: 'GET', url: `/api/overview?${Q}` })).json();
    const sum = (k: string) => ts.total.current.reduce((a: number, p: any) => a + (p[k] ?? 0), 0);
    // The overview excludes failed / no-ad-set campaigns from KPIs, which carry no data in the series either.
    expect(Math.round(sum('spend'))).toBeGreaterThan(0);
    expect(sum('impressions')).toBeGreaterThanOrEqual(ov.kpis.impressions * 0.99);
  });

  it('computes CTR/CPC from summed values, never by averaging daily rates', async () => {
    const ts = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}` })).json();
    for (const p of ts.total.current) {
      if (p.impressions) expect(p.ctr).toBeCloseTo((p.clicks / p.impressions) * 100, 6);
      if (p.clicks) expect(p.cpc).toBeCloseTo(p.spend / p.clicks, 6);
    }
  });

  it('a failed-sync campaign charts as null (a gap), never as zero', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/campaigns?${Q}&size=50` })).json();
    const failed = list.items.find((c: any) => c.reliability.reasonCode === 'f');
    expect(failed).toBeDefined();
    const ts = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}&campaignId=${failed.campaignId}` })).json();
    expect(ts.scope.type).toBe('campaign');
    for (const p of ts.total.current) {
      expect(p.spend).toBeNull();
      expect(p.ctr).toBeNull();
      expect(p.state).toBe('missing');
    }
  });

  it('single-campaign scope returns an ad-set breakdown', async () => {
    const list = (await app.inject({ method: 'GET', url: `/api/campaigns?${Q}&size=50` })).json();
    const ok = list.items.find((c: any) => c.reliability.isReliable && c.status === 'Active');
    const ts = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}&campaignId=${ok.campaignId}` })).json();
    expect(ts.byAdSet.length).toBeGreaterThan(0);
    expect(ts.byAdSet[0].current).toHaveLength(7);
  });

  it('scopes to a group and to a campaign selection', async () => {
    const groups = (await app.inject({ method: 'GET', url: `/api/groups?${Q}` })).json();
    const g = groups.groups.find((x: any) => x.campaignCount > 0);
    if (g) {
      const ts = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}&groupId=${g.id}` })).json();
      expect(ts.scope.type).toBe('group');
      expect(ts.scope.campaignCount).toBe(g.campaignCount);
    }
    const ts2 = (await app.inject({ method: 'GET', url: `/api/timeseries?${Q}&campaignIds=1,2,3` })).json();
    expect(ts2.scope.type).toBe('campaigns');
    expect(ts2.scope.campaignCount).toBeLessThanOrEqual(3);
  });

  it('rejects malformed or inverted dates', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/timeseries?current_start=garbage' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/timeseries?current_start=2026-11-14&current_end=2026-11-08' })).statusCode).toBe(400);
  });
});
