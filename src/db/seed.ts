import { getDb } from './connection.js';
import * as schema from './schema.js';
import { generateSampleData, RawCampaignDef, RawAdSetDef } from './seed-data.js';
import { backfillIssueDetected } from '../services/eventsService.js';

export async function seedDatabase(databaseUrl?: string) {
  const { db, raw } = await getDb(databaseUrl);

  const accountId = 'acme-cooling-in';
  const userId = 'u_demo_planner';

  // Clear existing data in reverse order of foreign keys
  const truncateTables = [
    'analytics_events',
    'activity_log',
    'alert_triggers',
    'alert_rules',
    'issues',
    'group_members',
    'groups',
    'daily_metrics',
    'ad_sets',
    'campaigns',
    'platform_connections',
    'settings',
    'users',
    'accounts',
  ];

  for (const table of truncateTables) {
    if ('exec' in raw) {
      await (raw as any).exec(`DELETE FROM ${table};`);
    } else {
      await (raw as any).query(`DELETE FROM ${table};`);
    }
  }

  // 1. Account
  await db.insert(schema.accounts).values({
    id: accountId,
    name: 'ACME Cooling India',
    currency: 'INR',
    timezone: 'Asia/Kolkata',
  });

  // 2. User
  await db.insert(schema.users).values({
    id: userId,
    accountId,
    name: 'Priya Nair',
    email: 'planner@acme.example',
    role: 'Media Planner',
    avatarInitials: 'PN',
  });

  // 3. Settings
  await db.insert(schema.settings).values({
    id: `settings_${accountId}`,
    accountId,
    dailySummaryEmail: true,
    notifyImmediateHigh: true,
    defaultReportingPeriod: 'Last 7 days vs previous 7 days',
    minImpressionsThreshold: 1000,
  });

  // 4. Platform Connections
  await db.insert(schema.platformConnections).values([
    {
      id: 'conn_meta',
      accountId,
      platform: 'Meta',
      status: 'connected',
      lastSuccessfulSyncAt: 'Nov 15, 08:40',
      syncMessage: 'Connected and current',
    },
    {
      id: 'conn_google',
      accountId,
      platform: 'Google',
      status: 'delayed',
      lastSuccessfulSyncAt: 'Nov 14, 21:10',
      syncMessage: 'Retry pending · 1 campaign sync failed',
    },
  ]);

  // 5. Generate sample data from prototype rules
  const { CAMP, ADS } = generateSampleData();

  // Insert campaigns
  for (const c of CAMP) {
    await db.insert(schema.campaigns).values({
      id: c.id,
      accountId,
      rawName: c.raw,
      displayName: c.name,
      platform: c.plat,
      objective: c.obj,
      status: c.status,
      initialStatus: c.status,
      budget: c.budget,
      spent: c.spent,
      startDate: c.start,
      endDate: c.end,
      learningFlag: c.status === 'Learning',
      syncStatus: c.nm || (c.q === 'delayed' ? 'delayed' : c.q === 'insufficient' ? 'insufficient' : 'ok'),
      lastSyncedAt: c.sync,
    });
  }

  // Insert ad sets
  for (const a of ADS) {
    await db.insert(schema.adSets).values({
      id: a.id,
      campaignId: a.cid,
      name: a.name,
      audience: a.aud,
      status: a.status,
      initialStatus: a.status,
    });
  }

  // 6. Generate Daily Metrics
  // We distribute the 7-day current metrics (2026-11-08 to 2026-11-14)
  // and 7-day previous metrics (2026-11-01 to 2026-11-07).
  // We also generate historical daily rows from 2026-09-01 to 2026-10-31,
  // and partial day for today (2026-11-15).
  const currentDates = [
    '2026-11-08',
    '2026-11-09',
    '2026-11-10',
    '2026-11-11',
    '2026-11-12',
    '2026-11-13',
    '2026-11-14',
  ];

  const previousDates = [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
    '2026-11-07',
  ];

  // Helper to partition an integer total across 7 days using prototype's shape function
  const partitionTotal = (tot: number | null | undefined, offset: number) => {
    if (tot == null || tot === 0) return Array(7).fill(tot == null ? null : 0);
    const weights = Array.from({ length: 7 }, (_, j) => 1 + 0.25 * Math.sin(j * 1.7 + offset));
    const totalW = weights.reduce((a, b) => a + b, 0);
    const result: number[] = [];
    let acc = 0;
    for (let j = 0; j < 6; j++) {
      const part = Math.round((tot * weights[j]) / totalW);
      result.push(part);
      acc += part;
    }
    result.push(tot - acc); // Last day gets remainder so sum matches exactly
    return result;
  };

  const dailyMetricRows: Array<typeof schema.dailyMetrics.$inferInsert> = [];

  for (const c of CAMP) {
    // If sync failed (e.g. Campaign 27)
    if (c.nm === 'failed') {
      // Missing data! Insert null daily rows with data_state = 'missing'
      for (const date of [...previousDates, ...currentDates, '2026-11-15']) {
        dailyMetricRows.push({
          accountId,
          date,
          campaignId: c.id,
          adSetId: null,
          spend: null,
          impressions: null,
          clicks: null,
          reach: null,
          engagements: null,
          conversions: null,
          revenue: null,
          dataState: 'missing',
        });
      }
      continue;
    }

    // If no ad sets (e.g. Campaign 26)
    if (c.nm === 'noadsets') {
      for (const date of [...previousDates, ...currentDates, '2026-11-15']) {
        dailyMetricRows.push({
          accountId,
          date,
          campaignId: c.id,
          adSetId: null,
          spend: '0',
          impressions: 0,
          clicks: 0,
          reach: 0,
          engagements: 0,
          conversions: 0,
          revenue: '0',
          dataState: 'complete',
        });
      }
      continue;
    }

    const campaignAdSets = ADS.filter((a) => a.cid === c.id);

    // Current period partitions
    const curSpendP = partitionTotal(c.spend, c.id);
    const curImprP = partitionTotal(c.impr, c.id);
    const curClicksP = partitionTotal(c.clicks, c.id * 2 + 1);
    const curReachP = partitionTotal(c.reach, c.id + 1);
    const curEngP = partitionTotal(c.eng, c.id + 2);
    const curConvP = partitionTotal(c.conv, c.id + 3);
    const curRevP = partitionTotal(c.rev, c.id + 4);

    // Previous period partitions
    const prevSpendP = partitionTotal(c.pSpend, c.id + 5);
    const prevImprP = partitionTotal(c.pImpr, c.id + 3);
    const prevClicksP = partitionTotal(c.pClicks, c.id * 2 + 4);
    const prevReachP = partitionTotal(c.pReach, c.id + 6);
    const prevEngP = partitionTotal(c.pEng, c.id + 7);
    const prevConvP = partitionTotal(c.pConv, c.id + 8);
    const prevRevP = partitionTotal(c.pRev, c.id + 9);

    const dataState = c.q === 'delayed' ? 'delayed' : 'complete';

    // Insert 7 current days
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = currentDates[dayIdx];
      const dSpend = curSpendP[dayIdx];
      const dImpr = curImprP[dayIdx];
      const dClicks = curClicksP[dayIdx];
      const dReach = curReachP[dayIdx];
      const dEng = curEngP[dayIdx];
      const dConv = curConvP[dayIdx];
      const dRev = curRevP[dayIdx];

      // Campaign row
      dailyMetricRows.push({
        accountId,
        date,
        campaignId: c.id,
        adSetId: null,
        spend: dSpend != null ? String(dSpend) : null,
        impressions: dImpr,
        clicks: dClicks,
        reach: dReach,
        engagements: dEng,
        conversions: dConv,
        revenue: dRev != null ? String(dRev) : null,
        dataState,
      });

      // Ad set rows
      if (campaignAdSets.length > 0) {
        let accSpend = 0;
        let accImpr = 0;
        let accClicks = 0;
        let accReach = 0;
        let accEng = 0;
        let accConv = 0;
        let accRev = 0;

        for (let aIdx = 0; aIdx < campaignAdSets.length; aIdx++) {
          const a = campaignAdSets[aIdx];
          const isLast = aIdx === campaignAdSets.length - 1;
          const ratio = (a.impr || 1) / (c.impr || 1);

          const aSpend = isLast ? (dSpend != null ? dSpend - accSpend : null) : (dSpend != null ? Math.round(dSpend * ratio) : null);
          const aImpr = isLast ? (dImpr != null ? dImpr - accImpr : null) : (dImpr != null ? Math.round(dImpr * ratio) : null);
          const aClicks = isLast ? (dClicks != null ? dClicks - accClicks : null) : (dClicks != null ? Math.round(dClicks * ratio) : null);
          const aReach = isLast ? (dReach != null ? dReach - accReach : null) : (dReach != null ? Math.round(dReach * ratio) : null);
          const aEng = isLast ? (dEng != null ? dEng - accEng : null) : (dEng != null ? Math.round(dEng * ratio) : null);
          const aConv = isLast ? (dConv != null ? dConv - accConv : null) : (dConv != null ? Math.round(dConv * ratio) : null);
          const aRev = isLast ? (dRev != null ? dRev - accRev : null) : (dRev != null ? Math.round(dRev * ratio) : null);

          if (aSpend != null) accSpend += aSpend;
          if (aImpr != null) accImpr += aImpr;
          if (aClicks != null) accClicks += aClicks;
          if (aReach != null) accReach += aReach;
          if (aEng != null) accEng += aEng;
          if (aConv != null) accConv += aConv;
          if (aRev != null) accRev += aRev;

          dailyMetricRows.push({
            accountId,
            date,
            campaignId: c.id,
            adSetId: a.id,
            spend: aSpend != null ? String(aSpend) : null,
            impressions: aImpr,
            clicks: aClicks,
            reach: aReach,
            engagements: aEng,
            conversions: aConv,
            revenue: aRev != null ? String(aRev) : null,
            dataState,
          });
        }
      }
    }

    // Insert 7 previous days
    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = previousDates[dayIdx];
      const dSpend = prevSpendP[dayIdx];
      const dImpr = prevImprP[dayIdx];
      const dClicks = prevClicksP[dayIdx];
      const dReach = prevReachP[dayIdx];
      const dEng = prevEngP[dayIdx];
      const dConv = prevConvP[dayIdx];
      const dRev = prevRevP[dayIdx];

      // Campaign row
      dailyMetricRows.push({
        accountId,
        date,
        campaignId: c.id,
        adSetId: null,
        spend: dSpend != null ? String(dSpend) : null,
        impressions: dImpr,
        clicks: dClicks,
        reach: dReach,
        engagements: dEng,
        conversions: dConv,
        revenue: dRev != null ? String(dRev) : null,
        dataState,
      });

      // Ad set rows
      if (campaignAdSets.length > 0) {
        let accSpend = 0;
        let accImpr = 0;
        let accClicks = 0;
        let accReach = 0;
        let accEng = 0;
        let accConv = 0;
        let accRev = 0;

        for (let aIdx = 0; aIdx < campaignAdSets.length; aIdx++) {
          const a = campaignAdSets[aIdx];
          const isLast = aIdx === campaignAdSets.length - 1;
          const ratio = (a.pImpr || 1) / (c.pImpr || 1);

          const aSpend = isLast ? (dSpend != null ? dSpend - accSpend : null) : (dSpend != null ? Math.round(dSpend * ratio) : null);
          const aImpr = isLast ? (dImpr != null ? dImpr - accImpr : null) : (dImpr != null ? Math.round(dImpr * ratio) : null);
          const aClicks = isLast ? (dClicks != null ? dClicks - accClicks : null) : (dClicks != null ? Math.round(dClicks * ratio) : null);
          const aReach = isLast ? (dReach != null ? dReach - accReach : null) : (dReach != null ? Math.round(dReach * ratio) : null);
          const aEng = isLast ? (dEng != null ? dEng - accEng : null) : (dEng != null ? Math.round(dEng * ratio) : null);
          const aConv = isLast ? (dConv != null ? dConv - accConv : null) : (dConv != null ? Math.round(dConv * ratio) : null);
          const aRev = isLast ? (dRev != null ? dRev - accRev : null) : (dRev != null ? Math.round(dRev * ratio) : null);

          if (aSpend != null) accSpend += aSpend;
          if (aImpr != null) accImpr += aImpr;
          if (aClicks != null) accClicks += aClicks;
          if (aReach != null) accReach += aReach;
          if (aEng != null) accEng += aEng;
          if (aConv != null) accConv += aConv;
          if (aRev != null) accRev += aRev;

          dailyMetricRows.push({
            accountId,
            date,
            campaignId: c.id,
            adSetId: a.id,
            spend: aSpend != null ? String(aSpend) : null,
            impressions: aImpr,
            clicks: aClicks,
            reach: aReach,
            engagements: aEng,
            conversions: aConv,
            revenue: aRev != null ? String(aRev) : null,
            dataState,
          });
        }
      }
    }

    // Insert today (2026-11-15, partial/provisional day through 09:00 AM)
    const partialFraction = 0.25;
    dailyMetricRows.push({
      accountId,
      date: '2026-11-15',
      campaignId: c.id,
      adSetId: null,
      spend: c.spend ? String(Math.round((c.spend / 7) * partialFraction)) : null,
      impressions: c.impr ? Math.round((c.impr / 7) * partialFraction) : null,
      clicks: c.clicks ? Math.round((c.clicks / 7) * partialFraction) : null,
      reach: c.reach ? Math.round((c.reach / 7) * partialFraction) : null,
      engagements: c.eng ? Math.round((c.eng / 7) * partialFraction) : null,
      conversions: c.conv ? Math.round((c.conv / 7) * partialFraction) : null,
      revenue: c.rev ? String(Math.round((c.rev / 7) * partialFraction)) : null,
      dataState: 'partial',
    });

    // Also insert 30 days of prior history (e.g. 2026-09-16 to 2026-10-31) so 30-day presets query real daily rows
    for (let day = 1; day <= 31; day++) {
      const dayStr = String(day).padStart(2, '0');
      const histDate = `2026-10-${dayStr}`;
      const avgSpend = Math.round(c.pSpend / 7);
      const avgImpr = Math.round(c.pImpr / 7);
      const avgClicks = Math.round(c.pClicks / 7);
      dailyMetricRows.push({
        accountId,
        date: histDate,
        campaignId: c.id,
        adSetId: null,
        spend: avgSpend ? String(avgSpend) : null,
        impressions: avgImpr || null,
        clicks: avgClicks || null,
        reach: c.pReach ? Math.round(c.pReach / 7) : null,
        engagements: c.pEng ? Math.round(c.pEng / 7) : null,
        conversions: c.pConv ? Math.round(c.pConv / 7) : null,
        revenue: c.pRev ? String(Math.round(c.pRev / 7)) : null,
        dataState: 'complete',
      });
    }
  }

  // Batch insert daily metrics in chunks of 500
  const chunkSize = 500;
  for (let i = 0; i < dailyMetricRows.length; i += chunkSize) {
    const chunk = dailyMetricRows.slice(i, i + chunkSize);
    await db.insert(schema.dailyMetrics).values(chunk);
  }

  // 7. Seed Groups
  const initialGroups = [
    {
      id: 'g2',
      accountId,
      name: 'Diwali Performance',
      description: 'Festive sales and EMI offers (includes an ended campaign for history)',
      updatedText: 'Nov 09',
      campaignIds: [4, 10, 21, 14],
    },
    {
      id: 'g3',
      accountId,
      name: 'Premium AC Launch',
      description: 'Teasers and premium video',
      updatedText: 'Nov 05',
      campaignIds: [5, 18, 12],
    },
    {
      id: 'g4',
      accountId,
      name: 'Regional Lead Generation',
      description: 'City-level lead campaigns',
      updatedText: 'Nov 12',
      campaignIds: [2, 8, 15, 16, 19],
    },
    {
      id: 'g5',
      accountId,
      name: 'Winter Pilot',
      description: 'Not yet populated',
      updatedText: 'Nov 13',
      campaignIds: [],
    },
  ];

  for (const g of initialGroups) {
    await db.insert(schema.groups).values({
      id: g.id,
      accountId: g.accountId,
      name: g.name,
      description: g.description,
      updatedText: g.updatedText,
    });

    for (const cid of g.campaignIds) {
      await db.insert(schema.groupMembers).values({
        groupId: g.id,
        campaignId: cid,
      });
    }
  }

  // 8. Seed Alert Rules
  const initialAlerts = [
    {
      id: 'a2',
      accountId,
      name: 'Lead CPC Spike',
      entityType: 'group',
      entityIds: JSON.stringify(['g4']),
      metric: 'cpc',
      condition: 'rise',
      threshold: '25',
      comparisonPeriod: 'Previous 7 days',
      recipient: 'planner@acme.example',
      frequency: 'Daily summary',
      status: 'Active',
      lastTriggeredAt: '—',
    },
    {
      id: 'a3',
      accountId,
      name: 'Diwali Spend Ceiling',
      entityType: 'group',
      entityIds: JSON.stringify(['g2']),
      metric: 'spend',
      condition: 'above',
      threshold: '500000',
      comparisonPeriod: 'Previous 7 days',
      recipient: 'planner@acme.example',
      frequency: 'Immediate',
      status: 'Active',
      lastTriggeredAt: '—',
    },
    {
      id: 'a4',
      accountId,
      name: 'Premium CTR Watch',
      entityType: 'group',
      entityIds: JSON.stringify(['g3']),
      metric: 'ctr',
      condition: 'drop',
      threshold: '15',
      comparisonPeriod: 'Previous 30 days',
      recipient: 'planner@acme.example',
      frequency: 'Daily summary',
      status: 'Paused',
      lastTriggeredAt: 'Nov 06, 09:12',
    },
  ];

  for (const a of initialAlerts) {
    await db.insert(schema.alertRules).values(a);
  }

  // 9. Seed Issues
  const initialIssues = [
    {
      id: 'c0',
      accountId,
      campaignId: 0,
      detectedAt: 'Today 6:10',
      detectedAtIso: '2026-11-15T06:10:00',
      severity: 'High',
      metric: 'CTR',
      changeDisplay: '−25.7%',
      whyText: 'CTR moved from 3.50% to 2.60% (−0.90 pp). The data does not show the cause.',
      state: 'open',
    },
    {
      id: 'p2',
      accountId,
      campaignId: 2,
      detectedAt: 'Today 8:24',
      detectedAtIso: '2026-11-15T08:24:00',
      severity: 'Medium',
      metric: 'CPC',
      changeDisplay: '+32.0%',
      whyText: 'CPC moved from previous period. For Leads campaigns, review against conversion volume before acting.',
      state: 'open',
    },
    {
      id: 'd6',
      accountId,
      campaignId: 6,
      detectedAt: 'Today 6:02',
      detectedAtIso: '2026-11-15T06:02:00',
      severity: 'High',
      metric: 'Data sync',
      changeDisplay: 'Delayed',
      whyText: 'Google Ads data last synced Nov 14, 21:10. Totals including this campaign may be incomplete.',
      state: 'open',
    },
    {
      id: 'd27',
      accountId,
      campaignId: 27,
      detectedAt: 'Today 6:49',
      detectedAtIso: '2026-11-15T06:49:00',
      severity: 'High',
      metric: 'Data sync',
      changeDisplay: 'Sync failed',
      whyText: 'Last successful Google Ads sync was Nov 11, 18:30. Data is unavailable and excluded from comparisons, group totals and alerts.',
      state: 'open',
    },
    {
      id: 's26',
      accountId,
      campaignId: 26,
      detectedAt: 'Today 8:42',
      detectedAtIso: '2026-11-15T08:42:00',
      severity: 'Info',
      metric: 'Setup',
      changeDisplay: 'No ad sets',
      whyText: 'No ad sets configured, so metrics are unavailable. Excluded from comparisons and ad-set-level alerts.',
      state: 'open',
    },
    {
      id: 'i5',
      accountId,
      campaignId: 5,
      detectedAt: 'Today 8:45',
      detectedAtIso: '2026-11-15T08:45:00',
      severity: 'Info',
      metric: 'CTR',
      changeDisplay: 'Not comparable',
      whyText: 'Impressions (640 current, 520 previous) are below the 1,000 minimum (illustrative assumption). Comparison and alerts suppressed.',
      state: 'open',
    },
    {
      id: 'b10',
      accountId,
      campaignId: 10,
      detectedAt: 'Today 7:20',
      detectedAtIso: '2026-11-15T07:20:00',
      severity: 'Medium',
      metric: 'Budget',
      changeDisplay: '88% used',
      whyText: 'Budget is 88% used; campaign scheduled until 2026-12-31.',
      state: 'open',
    },
  ];

  for (const iss of initialIssues) {
    await db.insert(schema.issues).values(iss);
  }
  // Detection happened before the planner opened Governance: record it so detect-to-investigate is measurable.
  await backfillIssueDetected(accountId, userId, initialIssues);

  // 10. Seed Activity Log
  const initialLogs = [
    {
      accountId,
      userId,
      userName: 'Priya Nair',
      timestampText: 'Nov 13, 17:20',
      type: 'Alert',
      actionText: 'Alert "Premium CTR Watch" paused',
      relatedEntity: 'Premium AC Launch',
    },
    {
      accountId,
      userId,
      userName: 'Priya Nair',
      timestampText: 'Nov 12, 11:05',
      type: 'Group',
      actionText: 'Campaign "Pune Lead Gen" added to group',
      relatedEntity: 'Regional Lead Generation',
    },
    {
      accountId,
      userId,
      userName: 'Priya Nair',
      timestampText: 'Nov 10, 10:30',
      type: 'Group',
      actionText: 'Group "Winter Pilot" created',
      relatedEntity: 'Winter Pilot',
    },
    {
      accountId,
      userId,
      userName: 'Priya Nair',
      timestampText: 'Nov 09, 09:48',
      type: 'Campaign',
      actionText: 'Campaign opened',
      relatedEntity: 'Diwali Cooling Offers',
    },
  ];

  for (const log of initialLogs) {
    await db.insert(schema.activityLog).values(log);
  }

  return { campaignsCount: CAMP.length, adSetsCount: ADS.length, dailyRowsCount: dailyMetricRows.length };
}

// If executed directly via CLI: tsx src/db/seed.ts
if (process.argv[1]?.endsWith('seed.ts')) {
  console.log('Seeding Vajra Governance database...');
  seedDatabase()
    .then((res) => {
      console.log('Successfully seeded database:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed database:', err);
      process.exit(1);
    });
}
