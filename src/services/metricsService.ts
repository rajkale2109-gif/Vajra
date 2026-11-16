import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { eq, and, inArray, gte, lte, isNull } from 'drizzle-orm';
import {
  RawMetrics,
  ComputedMetrics,
  CampaignComparison,
  AggregatedResult,
} from '../calculations/types.js';
import {
  computeMetrics,
  calculateChange,
  calculateCtrChange,
} from '../calculations/metrics.js';
import {
  classifyReliability,
  ReliabilityOptions,
} from '../calculations/reliability.js';
import { aggregateCampaigns } from '../calculations/aggregations.js';
import { config } from '../config/index.js';

export interface DateRangeParams {
  currentStart: string; // YYYY-MM-DD
  currentEnd: string;   // YYYY-MM-DD
  previousStart: string;
  previousEnd: string;
}

export interface IssueItem {
  id: string;
  campaignId: number;
  campaignName: string;
  platform: string;
  severity: 'High' | 'Medium' | 'Info';
  metric: string;
  changeDisplay: string;
  whyText: string;
  detectedAt: string;
  state: 'open' | 'reviewed' | 'dismissed' | 'resolved';
}

export interface CampaignWithComparison extends CampaignComparison {
  name: string;
  raw: string;
  platform: string;
  objective: string;
  status: string;
  budget: number | null;
  spent: number | null;
  startDate: string;
  endDate: string;
  lastSync: string;
  issues: IssueItem[];
}

export class MetricsService {
  /**
   * Queries real daily rows from the database and returns dynamic campaign comparisons
   * for any arbitrary date range.
   */
  async getCampaignComparisons(
    accountId: string,
    dates: DateRangeParams,
    options: Partial<ReliabilityOptions> = {}
  ): Promise<CampaignWithComparison[]> {
    const { db } = await getDb();

    // 1. Fetch campaigns and settings for this account
    const campaignList = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.accountId, accountId));

    const [accountSettings] = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.accountId, accountId));

    const minThreshold =
      options.minImpressionsThreshold ??
      accountSettings?.minImpressionsThreshold ??
      config.DEFAULT_MIN_IMPRESSIONS;

    const todayDate = options.todayDate ?? config.SIMULATED_CURRENT_DATE;

    // 2. Query ad sets count per campaign
    const adSetsList = await db
      .select({
        id: schema.adSets.id,
        campaignId: schema.adSets.campaignId,
      })
      .from(schema.adSets);

    const adSetCountMap = new Map<number, number>();
    for (const a of adSetsList) {
      adSetCountMap.set(a.campaignId, (adSetCountMap.get(a.campaignId) || 0) + 1);
    }

    // 3. Query daily metrics for current period
    const currentRows = await db
      .select()
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.accountId, accountId),
          isNull(schema.dailyMetrics.adSetId),
          gte(schema.dailyMetrics.date, dates.currentStart),
          lte(schema.dailyMetrics.date, dates.currentEnd)
        )
      );

    // 4. Query daily metrics for previous period
    const prevRows = await db
      .select()
      .from(schema.dailyMetrics)
      .where(
        and(
          eq(schema.dailyMetrics.accountId, accountId),
          isNull(schema.dailyMetrics.adSetId),
          gte(schema.dailyMetrics.date, dates.previousStart),
          lte(schema.dailyMetrics.date, dates.previousEnd)
        )
      );

    // 5. Query open/reviewed/dismissed issues
    const issuesList = await db
      .select()
      .from(schema.issues)
      .where(eq(schema.issues.accountId, accountId));

    // Aggregate daily metrics by campaign ID
    const curMap = new Map<number, RawMetrics>();
    for (const r of currentRows) {
      const prev = curMap.get(r.campaignId) || {
        spend: null,
        impressions: null,
        clicks: null,
        reach: null,
        engagements: null,
        conversions: null,
        revenue: null,
      };
      curMap.set(r.campaignId, {
        spend: (prev.spend || 0) + (r.spend ? Number(r.spend) : 0),
        impressions: (prev.impressions || 0) + (r.impressions || 0),
        clicks: (prev.clicks || 0) + (r.clicks || 0),
        reach: (prev.reach || 0) + (r.reach || 0),
        engagements: (prev.engagements || 0) + (r.engagements || 0),
        conversions: (prev.conversions || 0) + (r.conversions || 0),
        revenue: (prev.revenue || 0) + (r.revenue ? Number(r.revenue) : 0),
      });
    }

    const prevMap = new Map<number, RawMetrics>();
    for (const r of prevRows) {
      const prev = prevMap.get(r.campaignId) || {
        spend: null,
        impressions: null,
        clicks: null,
        reach: null,
        engagements: null,
        conversions: null,
        revenue: null,
      };
      prevMap.set(r.campaignId, {
        spend: (prev.spend || 0) + (r.spend ? Number(r.spend) : 0),
        impressions: (prev.impressions || 0) + (r.impressions || 0),
        clicks: (prev.clicks || 0) + (r.clicks || 0),
        reach: (prev.reach || 0) + (r.reach || 0),
        engagements: (prev.engagements || 0) + (r.engagements || 0),
        conversions: (prev.conversions || 0) + (r.conversions || 0),
        revenue: (prev.revenue || 0) + (r.revenue ? Number(r.revenue) : 0),
      });
    }

    const relOptions: ReliabilityOptions = {
      minImpressionsThreshold: minThreshold,
      todayDate,
      currentPeriodEnd: dates.currentEnd,
    };

    const results: CampaignWithComparison[] = [];

    for (const c of campaignList) {
      const adSetCount = adSetCountMap.get(c.id) ?? 0;
      const isFailed = c.syncStatus === 'failed';
      const isNoAdSets = c.syncStatus === 'noadsets' || adSetCount === 0;

      const rawCur = isFailed
        ? { spend: null, impressions: null, clicks: null }
        : curMap.get(c.id) || { spend: 0, impressions: 0, clicks: 0 };

      const rawPrev = isFailed
        ? { spend: null, impressions: null, clicks: null }
        : prevMap.get(c.id) || { spend: 0, impressions: 0, clicks: 0 };

      const curComputed = isFailed || isNoAdSets
        ? {
            spend: null,
            impressions: null,
            clicks: null,
            reach: null,
            engagements: null,
            conversions: null,
            revenue: null,
            ctr: null,
            cpc: null,
            cpm: null,
            engagementRate: null,
            costPerEngagement: null,
            conversionRate: null,
            costPerConversion: null,
            roas: null,
          }
        : computeMetrics(rawCur);

      const prevComputed = isFailed || isNoAdSets
        ? {
            spend: null,
            impressions: null,
            clicks: null,
            reach: null,
            engagements: null,
            conversions: null,
            revenue: null,
            ctr: null,
            cpc: null,
            cpm: null,
            engagementRate: null,
            costPerEngagement: null,
            conversionRate: null,
            costPerConversion: null,
            roas: null,
          }
        : computeMetrics(rawPrev);

      const reliability = classifyReliability(
        {
          id: c.id,
          name: c.displayName,
          status: c.status,
          syncStatus: c.syncStatus,
          lastSync: c.lastSyncedAt,
          adSetCount,
        },
        rawCur,
        rawPrev,
        relOptions
      );

      const changes = {
        spend: calculateChange(curComputed.spend, prevComputed.spend),
        impressions: calculateChange(curComputed.impressions, prevComputed.impressions),
        clicks: calculateChange(curComputed.clicks, prevComputed.clicks),
        ctr: calculateCtrChange(curComputed.ctr, prevComputed.ctr),
        cpc: calculateChange(curComputed.cpc, prevComputed.cpc),
        cpm: calculateChange(curComputed.cpm, prevComputed.cpm),
        reach: calculateChange(curComputed.reach, prevComputed.reach),
        engagements: calculateChange(curComputed.engagements, prevComputed.engagements),
        conversions: calculateChange(curComputed.conversions, prevComputed.conversions),
        revenue: calculateChange(curComputed.revenue, prevComputed.revenue),
        roas: calculateChange(curComputed.roas, prevComputed.roas),
      };

      const cIssues: IssueItem[] = issuesList
        .filter((i) => i.campaignId === c.id && i.state !== 'dismissed')
        .map((i) => ({
          id: i.id,
          campaignId: i.campaignId,
          campaignName: c.displayName,
          platform: c.platform,
          severity: i.severity as 'High' | 'Medium' | 'Info',
          metric: i.metric,
          changeDisplay: i.changeDisplay,
          whyText: i.whyText,
          detectedAt: i.detectedAt,
          state: i.state as 'open' | 'reviewed' | 'dismissed' | 'resolved',
        }));

      results.push({
        campaignId: c.id,
        name: c.displayName,
        raw: c.rawName,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        budget: c.budget,
        spent: c.spent,
        startDate: c.startDate,
        endDate: c.endDate,
        lastSync: c.lastSyncedAt,
        current: curComputed,
        previous: prevComputed,
        changes,
        reliability,
        issues: cIssues,
      });
    }

    return results;
  }

  /**
   * Generates dynamic Overview KPIs and like-for-like aggregations
   */
  async getOverviewData(
    accountId: string,
    dates: DateRangeParams
  ): Promise<{
    dates: DateRangeParams;
    kpis: {
      totalCampaigns: number;
      activeCampaigns: number;
      spend: number | null;
      prevSpend: number | null;
      spendChange: number | null;
      impressions: number | null;
      prevImpressions: number | null;
      impressionsChange: number | null;
      clicks: number | null;
      prevClicks: number | null;
      clicksChange: number | null;
      activeIssuesCount: number;
      activeRulesCount: number;
    };
    aggregates: AggregatedResult;
    issues: IssueItem[];
    platformConnections: Array<typeof schema.platformConnections.$inferSelect>;
    dataQuality: {
      hasDelayedGoogle: boolean;
      delayedGoogleCount: number;
      hasFailedSync: boolean;
      failedSyncCount: number;
      isProvisional: boolean;
      todayDate: string;
    };
  }> {
    const { db } = await getDb();

    const comparisons = await this.getCampaignComparisons(accountId, dates);

    const platformConnections = await db
      .select()
      .from(schema.platformConnections)
      .where(eq(schema.platformConnections.accountId, accountId));

    const alertRules = await db
      .select()
      .from(schema.alertRules)
      .where(
        and(
          eq(schema.alertRules.accountId, accountId),
          eq(schema.alertRules.status, 'Active')
        )
      );

    const issues = await db
      .select()
      .from(schema.issues)
      .where(
        and(
          eq(schema.issues.accountId, accountId),
          eq(schema.issues.state, 'open')
        )
      );

    // Map comparisons to CampaignWithMetrics for aggregateCampaigns
    const itemsForAgg = comparisons.map((c) => ({
      campaign: {
        id: c.campaignId,
        name: c.name,
        status: c.status,
        syncStatus: c.reliability.reasonCode === 'f' ? 'failed' : c.reliability.reasonCode === 'n' ? 'noadsets' : c.reliability.reasonCode === 'd' ? 'delayed' : 'ok',
        lastSync: c.lastSync,
      },
      current: c.current,
      previous: c.previous,
    }));

    const aggregates = aggregateCampaigns(itemsForAgg, {
      minImpressionsThreshold: config.DEFAULT_MIN_IMPRESSIONS,
      todayDate: config.SIMULATED_CURRENT_DATE,
      currentPeriodEnd: dates.currentEnd,
    });

    const activeCampaignsCount = comparisons.filter(
      (c) => c.status === 'Active'
    ).length;

    const delayedCampaigns = comparisons.filter(
      (c) => c.reliability.status === 'delayed'
    );
    const failedCampaigns = comparisons.filter(
      (c) => c.reliability.status === 'sync_failed'
    );

    const mappedIssues: IssueItem[] = issues.map((i) => {
      const camp = comparisons.find((c) => c.campaignId === i.campaignId);
      return {
        id: i.id,
        campaignId: i.campaignId,
        campaignName: camp?.name || `Campaign ${i.campaignId}`,
        platform: camp?.platform || 'Meta',
        severity: i.severity as 'High' | 'Medium' | 'Info',
        metric: i.metric,
        changeDisplay: i.changeDisplay,
        whyText: i.whyText,
        detectedAt: i.detectedAt,
        state: i.state as 'open' | 'reviewed' | 'dismissed' | 'resolved',
      };
    });

    // Sort issues by severity: High (0), Medium (1), Info (2)
    const sevOrder = { High: 0, Medium: 1, Info: 2 };
    mappedIssues.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

    return {
      dates,
      kpis: {
        totalCampaigns: comparisons.length,
        activeCampaigns: activeCampaignsCount,
        spend: aggregates.current.spend,
        prevSpend: aggregates.previous.spend,
        spendChange: aggregates.changes.spend.relativePct,
        impressions: aggregates.current.impressions,
        prevImpressions: aggregates.previous.impressions,
        impressionsChange: aggregates.changes.impressions.relativePct,
        clicks: aggregates.current.clicks,
        prevClicks: aggregates.previous.clicks,
        clicksChange: aggregates.changes.clicks.relativePct,
        activeIssuesCount: mappedIssues.length,
        activeRulesCount: alertRules.length,
      },
      aggregates,
      issues: mappedIssues,
      platformConnections,
      dataQuality: {
        hasDelayedGoogle: delayedCampaigns.length > 0,
        delayedGoogleCount: delayedCampaigns.length,
        hasFailedSync: failedCampaigns.length > 0,
        failedSyncCount: failedCampaigns.length,
        isProvisional: dates.currentEnd >= config.SIMULATED_CURRENT_DATE,
        todayDate: config.SIMULATED_CURRENT_DATE,
      },
    };
  }
}

export const metricsService = new MetricsService();
