import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb } from '../../src/db/connection.js';
import { seedDatabase } from '../../src/db/seed.js';
import * as schema from '../../src/db/schema.js';
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { computeMetrics, calculateCtrChange } from '../../src/calculations/metrics.js';

describe('Database & Seed Integration Tests', () => {
  beforeAll(async () => {
    await seedDatabase();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('seeds 28 campaigns matching the prototype', async () => {
    const { db } = await getDb();
    const allCampaigns = await db.select().from(schema.campaigns);
    expect(allCampaigns).toHaveLength(28);

    const summerCampaign = allCampaigns.find((c) => c.id === 0);
    expect(summerCampaign).toBeDefined();
    expect(summerCampaign?.displayName).toBe('Summer AC Awareness');
    expect(summerCampaign?.platform).toBe('Meta');
    expect(summerCampaign?.objective).toBe('Awareness');
    expect(summerCampaign?.status).toBe('Active');
  });

  it('seeds ad sets for applicable campaigns and verifies Campaign 26 has no ad sets', async () => {
    const { db } = await getDb();
    const allAdSets = await db.select().from(schema.adSets);
    expect(allAdSets.length).toBeGreaterThan(60);

    // Campaign 26: New AC Launch Setup
    const camp26AdSets = await db
      .select()
      .from(schema.adSets)
      .where(eq(schema.adSets.campaignId, 26));
    expect(camp26AdSets).toHaveLength(0);

    // Campaign 0: Summer AC Awareness has 4 ad sets
    const camp0AdSets = await db
      .select()
      .from(schema.adSets)
      .where(eq(schema.adSets.campaignId, 0));
    expect(camp0AdSets).toHaveLength(4);
    const names = camp0AdSets.map((a) => a.name);
    expect(names).toContain('AS1 — Broad Audience');
    expect(names).toContain('AS2 — Tier 2 Cities');
    expect(names).toContain('AS3 — Lookalike');
    expect(names).toContain('AS4 — Retargeting');
  });

  it('verifies the Summer AC Awareness story from real daily rows: CTR 3.50% -> 2.60% (-0.90 pp, -25.7%)', async () => {
    const { db } = await getDb();

    // Query daily rows for Nov 08-14 (current period)
    const currentDates = [
      '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11',
      '2026-11-12', '2026-11-13', '2026-11-14',
    ];
    const currentRows = await db
      .select()
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.campaignId, 0),
          isNull(schema.dailyMetrics.adSetId),
          inArray(schema.dailyMetrics.date, currentDates)
        )
      );

    expect(currentRows).toHaveLength(7);
    const curImpr = currentRows.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const curClicks = currentRows.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const curComputed = computeMetrics({ spend: 0, impressions: curImpr, clicks: curClicks });

    // Query daily rows for Nov 01-07 (previous period)
    const previousDates = [
      '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04',
      '2026-11-05', '2026-11-06', '2026-11-07',
    ];
    const prevRows = await db
      .select()
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.campaignId, 0),
          isNull(schema.dailyMetrics.adSetId),
          inArray(schema.dailyMetrics.date, previousDates)
        )
      );

    expect(prevRows).toHaveLength(7);
    const prevImpr = prevRows.reduce((sum, r) => sum + (r.impressions || 0), 0);
    const prevClicks = prevRows.reduce((sum, r) => sum + (r.clicks || 0), 0);
    const prevComputed = computeMetrics({ spend: 0, impressions: prevImpr, clicks: prevClicks });

    // Verify CTR values
    expect(curComputed.ctr).toBeCloseTo(2.6, 2);
    expect(prevComputed.ctr).toBeCloseTo(3.5, 2);

    // Verify changes
    const ctrChange = calculateCtrChange(curComputed.ctr, prevComputed.ctr);
    expect(ctrChange.percentagePoints).toBeCloseTo(-0.9, 2);
    expect(ctrChange.relativePct).toBeCloseTo(-25.7, 1);
  });

  it('verifies failed sync (Campaign 27) daily metrics are NULL/missing, never zero', async () => {
    const { db } = await getDb();
    const rows = await db
      .select()
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.campaignId, 27),
          isNull(schema.dailyMetrics.adSetId)
        )
      );

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dataState).toBe('missing');
      expect(r.spend).toBeNull();
      expect(r.impressions).toBeNull();
      expect(r.clicks).toBeNull();
    }
  });

  it('verifies groups, group members, alert rules, and issues are seeded', async () => {
    const { db } = await getDb();

    const allGroups = await db.select().from(schema.groups);
    expect(allGroups).toHaveLength(4);

    const members = await db.select().from(schema.groupMembers);
    expect(members.length).toBeGreaterThan(0);

    const alerts = await db.select().from(schema.alertRules);
    expect(alerts).toHaveLength(3);

    const allIssues = await db.select().from(schema.issues);
    expect(allIssues.length).toBeGreaterThanOrEqual(7);

    // Verify Summer AC Awareness CTR issue is present
    const c0Issue = allIssues.find((i) => i.id === 'c0');
    expect(c0Issue).toBeDefined();
    expect(c0Issue?.severity).toBe('High');
    expect(c0Issue?.metric).toBe('CTR');
    expect(c0Issue?.changeDisplay).toBe('−25.7%');
  });
});
