import { and, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { config } from '../config/index.js';
import type { DateRangeParams } from './metricsService.js';

/**
 * Daily time series for the "View graph" feature.
 *
 * Rules (same as the tables):
 *  - Missing data is null, never 0 (a failed sync must not draw as a collapse to zero).
 *  - CTR / CPC are recomputed from summed clicks / impressions / spend, never averaged.
 *  - Current and previous periods are aligned by day index so they can be overlaid.
 */

export interface SeriesPoint {
  date: string;
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  ctr: number | null;
  cpc: number | null;
  /** 'ok' | 'delayed' (late sync) | 'partial' | 'missing' | 'provisional' (today, partial day) */
  state: string;
}

export interface SeriesPair {
  key: string;
  label: string;
  platform?: string;
  current: SeriesPoint[];
  previous: SeriesPoint[];
}

export interface TimeseriesResult {
  dates: DateRangeParams;
  scope: { type: 'account' | 'campaigns' | 'group' | 'campaign'; label: string; campaignCount: number };
  days: Array<{ index: number; current: string | null; previous: string | null }>;
  total: SeriesPair;
  byPlatform: SeriesPair[];
  byCampaign: SeriesPair[];
  byAdSet: SeriesPair[];
  todayDate: string;
}

export interface TimeseriesOptions {
  campaignIds?: number[];
  groupId?: string;
  /** Single campaign → also return an ad-set breakdown. */
  campaignId?: number;
  topN?: number;
}

type Row = typeof schema.dailyMetrics.$inferSelect;

const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

const dayList = (start: string, end: string): string[] => {
  const out: string[] = [];
  const max = 400; // hard cap so a bad range can't blow up the response
  for (let d = start, i = 0; d <= end && i < max; d = addDays(d, 1), i++) out.push(d);
  return out;
};

function pointFor(date: string | null, rows: Row[], today: string): SeriesPoint {
  if (!date) {
    return { date: '', spend: null, impressions: null, clicks: null, conversions: null, revenue: null, ctr: null, cpc: null, state: 'missing' };
  }
  // Rows that actually carry data (a 'missing' row has null metrics).
  const usable = rows.filter((r) => r.dataState !== 'missing' && r.impressions != null);
  if (!usable.length) {
    return { date, spend: null, impressions: null, clicks: null, conversions: null, revenue: null, ctr: null, cpc: null, state: 'missing' };
  }
  let spend = 0;
  let impressions = 0;
  let clicks = 0;
  let conversions = 0;
  let revenue = 0;
  let state = 'ok';
  for (const r of usable) {
    spend += r.spend ? Number(r.spend) : 0;
    impressions += r.impressions ?? 0;
    clicks += r.clicks ?? 0;
    conversions += r.conversions ?? 0;
    revenue += r.revenue ? Number(r.revenue) : 0;
    if (r.dataState === 'delayed' && state === 'ok') state = 'delayed';
    if (r.dataState === 'partial') state = 'partial';
  }
  if (date >= today) state = 'provisional';
  return {
    date,
    spend,
    impressions,
    clicks,
    conversions,
    revenue,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    state,
  };
}

function buildPair(
  key: string,
  label: string,
  rows: Row[],
  curDays: Array<string | null>,
  prevDays: Array<string | null>,
  today: string,
  platform?: string
): SeriesPair {
  const byDate = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  const mk = (days: Array<string | null>) => days.map((d) => pointFor(d, d ? byDate.get(d) ?? [] : [], today));
  return { key, label, platform, current: mk(curDays), previous: mk(prevDays) };
}

const sumSpend = (p: SeriesPair) => p.current.reduce((a, x) => a + (x.spend ?? 0), 0);

export async function getTimeseries(accountId: string, dates: DateRangeParams, opts: TimeseriesOptions = {}): Promise<TimeseriesResult> {
  const { db } = await getDb();
  const today = config.SIMULATED_CURRENT_DATE;
  const topN = opts.topN ?? 8;

  const curList = dayList(dates.currentStart, dates.currentEnd);
  const prevList = dayList(dates.previousStart, dates.previousEnd);
  const len = Math.max(curList.length, prevList.length);
  const curDays: Array<string | null> = Array.from({ length: len }, (_, i) => curList[i] ?? null);
  const prevDays: Array<string | null> = Array.from({ length: len }, (_, i) => prevList[i] ?? null);

  // ---- Which campaigns are in scope ---------------------------------------
  const allCampaigns = await db.select().from(schema.campaigns).where(eq(schema.campaigns.accountId, accountId));
  let scoped = allCampaigns;
  let scope: TimeseriesResult['scope'] = { type: 'account', label: 'All campaigns', campaignCount: allCampaigns.length };

  if (opts.campaignId != null) {
    scoped = allCampaigns.filter((c) => c.id === opts.campaignId);
    scope = { type: 'campaign', label: scoped[0]?.displayName ?? `Campaign ${opts.campaignId}`, campaignCount: scoped.length };
  } else if (opts.groupId) {
    const members = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, opts.groupId));
    const ids = new Set(members.map((m) => m.campaignId));
    const [g] = await db.select().from(schema.groups).where(and(eq(schema.groups.id, opts.groupId), eq(schema.groups.accountId, accountId)));
    scoped = allCampaigns.filter((c) => ids.has(c.id));
    scope = { type: 'group', label: g?.name ?? opts.groupId, campaignCount: scoped.length };
  } else if (opts.campaignIds?.length) {
    const ids = new Set(opts.campaignIds);
    scoped = allCampaigns.filter((c) => ids.has(c.id));
    scope = { type: 'campaigns', label: `${scoped.length} selected campaign${scoped.length === 1 ? '' : 's'}`, campaignCount: scoped.length };
  }

  const scopedIds = scoped.map((c) => c.id);
  const from = [dates.previousStart, dates.currentStart].sort()[0];
  const to = [dates.previousEnd, dates.currentEnd].sort().slice(-1)[0];

  const rows: Row[] = scopedIds.length
    ? await db
        .select()
        .from(schema.dailyMetrics)
        .where(
          and(
            eq(schema.dailyMetrics.accountId, accountId),
            isNull(schema.dailyMetrics.adSetId),
            inArray(schema.dailyMetrics.campaignId, scopedIds),
            gte(schema.dailyMetrics.date, from),
            lte(schema.dailyMetrics.date, to)
          )
        )
    : [];

  const total = buildPair('total', scope.label, rows, curDays, prevDays, today);

  const platformOf = new Map(scoped.map((c) => [c.id, c.platform]));
  const platforms = [...new Set(scoped.map((c) => c.platform))].sort();
  const byPlatform = platforms.map((p) =>
    buildPair(p, p, rows.filter((r) => platformOf.get(r.campaignId) === p), curDays, prevDays, today, p)
  );

  // Per-campaign lines are only useful with more than one campaign; keep the top spenders.
  let byCampaign: SeriesPair[] = [];
  if (scoped.length > 1) {
    byCampaign = scoped
      .map((c) =>
        buildPair(String(c.id), c.displayName, rows.filter((r) => r.campaignId === c.id), curDays, prevDays, today, c.platform)
      )
      .sort((a, b) => sumSpend(b) - sumSpend(a))
      .slice(0, topN);
  }

  // Ad-set breakdown for a single-campaign drilldown.
  let byAdSet: SeriesPair[] = [];
  if (opts.campaignId != null) {
    const adSets = await db.select().from(schema.adSets).where(eq(schema.adSets.campaignId, opts.campaignId));
    if (adSets.length) {
      const adRows: Row[] = await db
        .select()
        .from(schema.dailyMetrics)
        .where(
          and(
            eq(schema.dailyMetrics.accountId, accountId),
            eq(schema.dailyMetrics.campaignId, opts.campaignId),
            isNotNull(schema.dailyMetrics.adSetId),
            gte(schema.dailyMetrics.date, from),
            lte(schema.dailyMetrics.date, to)
          )
        );
      byAdSet = adSets
        .map((a) => buildPair(a.id, a.name, adRows.filter((r) => r.adSetId === a.id), curDays, prevDays, today))
        .sort((a, b) => sumSpend(b) - sumSpend(a));
    }
  }

  return {
    dates,
    scope,
    days: curDays.map((c, i) => ({ index: i, current: c, previous: prevDays[i] })),
    total,
    byPlatform,
    byCampaign,
    byAdSet,
    todayDate: today,
  };
}
