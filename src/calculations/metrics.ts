import {
  RawMetrics,
  ComputedMetrics,
  MetricChange,
  CtrChange,
} from './types.js';

/**
 * Calculates percentage relative change: (current - previous) / previous * 100.
 * Returns null (never Infinity, -Infinity, or NaN) if previous is 0, null, or undefined,
 * or if current is null or undefined.
 */
export function calculateRelativeChange(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (
    current == null ||
    previous == null ||
    isNaN(current) ||
    isNaN(previous) ||
    previous === 0
  ) {
    return null;
  }
  const change = ((current - previous) / previous) * 100;
  return Number.isFinite(change) ? change : null;
}

/**
 * Calculates percentage points change: current - previous.
 * Returns null if either value is null, undefined, or NaN.
 */
export function calculatePercentagePoints(
  current: number | null | undefined,
  previous: number | null | undefined
): number | null {
  if (
    current == null ||
    previous == null ||
    isNaN(current) ||
    isNaN(previous)
  ) {
    return null;
  }
  const diff = current - previous;
  return Number.isFinite(diff) ? diff : null;
}

/**
 * Calculates both relative percentage and percentage points for CTR changes.
 */
export function calculateCtrChange(
  currentCtr: number | null | undefined,
  previousCtr: number | null | undefined
): CtrChange {
  return {
    current: currentCtr ?? null,
    previous: previousCtr ?? null,
    relativePct: calculateRelativeChange(currentCtr, previousCtr),
    percentagePoints: calculatePercentagePoints(currentCtr, previousCtr),
  };
}

/**
 * Helper to construct a standard MetricChange object.
 */
export function calculateChange(
  current: number | null | undefined,
  previous: number | null | undefined
): MetricChange {
  return {
    current: current ?? null,
    previous: previous ?? null,
    relativePct: calculateRelativeChange(current, previous),
  };
}

/**
 * Computes derived ratios from raw metric values:
 * - CTR = clicks / impressions * 100
 * - CPC = spend / clicks
 * - CPM = spend / impressions * 1000
 * - engagementRate = engagements / impressions * 100
 * - costPerEngagement = spend / engagements
 * - conversionRate = conversions / clicks * 100
 * - costPerConversion = spend / conversions
 * - ROAS = revenue / spend
 *
 * Missing or 0 denominators return null, never Infinity or NaN.
 */
export function computeMetrics(raw: RawMetrics): ComputedMetrics {
  const spend = raw.spend != null && !isNaN(raw.spend) ? raw.spend : null;
  const impressions =
    raw.impressions != null && !isNaN(raw.impressions) ? raw.impressions : null;
  const clicks = raw.clicks != null && !isNaN(raw.clicks) ? raw.clicks : null;
  const reach = raw.reach != null && !isNaN(raw.reach) ? raw.reach : null;
  const engagements =
    raw.engagements != null && !isNaN(raw.engagements) ? raw.engagements : null;
  const conversions =
    raw.conversions != null && !isNaN(raw.conversions) ? raw.conversions : null;
  const revenue = raw.revenue != null && !isNaN(raw.revenue) ? raw.revenue : null;

  const ctr =
    impressions != null && impressions > 0 && clicks != null
      ? (clicks / impressions) * 100
      : null;

  const cpc =
    clicks != null && clicks > 0 && spend != null ? spend / clicks : null;

  const cpm =
    impressions != null && impressions > 0 && spend != null
      ? (spend / impressions) * 1000
      : null;

  const engagementRate =
    impressions != null && impressions > 0 && engagements != null
      ? (engagements / impressions) * 100
      : null;

  const costPerEngagement =
    engagements != null && engagements > 0 && spend != null
      ? spend / engagements
      : null;

  const conversionRate =
    clicks != null && clicks > 0 && conversions != null
      ? (conversions / clicks) * 100
      : null;

  const costPerConversion =
    conversions != null && conversions > 0 && spend != null
      ? spend / conversions
      : null;

  const roas =
    spend != null && spend > 0 && revenue != null ? revenue / spend : null;

  return {
    spend,
    impressions,
    clicks,
    reach,
    engagements,
    conversions,
    revenue,
    ctr,
    cpc,
    cpm,
    engagementRate,
    costPerEngagement,
    conversionRate,
    costPerConversion,
    roas,
  };
}

/**
 * Aggregates a list of metric rows by SUMMING underlying totals, then computing ratios.
 * NEVER averages ratios.
 */
export function aggregateRawMetrics(items: RawMetrics[]): ComputedMetrics {
  let hasAnySpend = false;
  let totalSpend = 0;

  let hasAnyImpressions = false;
  let totalImpressions = 0;

  let hasAnyClicks = false;
  let totalClicks = 0;

  let hasAnyReach = false;
  let totalReach = 0;

  let hasAnyEngagements = false;
  let totalEngagements = 0;

  let hasAnyConversions = false;
  let totalConversions = 0;

  let hasAnyRevenue = false;
  let totalRevenue = 0;

  for (const item of items) {
    if (item.spend != null && !isNaN(item.spend)) {
      totalSpend += item.spend;
      hasAnySpend = true;
    }
    if (item.impressions != null && !isNaN(item.impressions)) {
      totalImpressions += item.impressions;
      hasAnyImpressions = true;
    }
    if (item.clicks != null && !isNaN(item.clicks)) {
      totalClicks += item.clicks;
      hasAnyClicks = true;
    }
    if (item.reach != null && !isNaN(item.reach)) {
      totalReach += item.reach;
      hasAnyReach = true;
    }
    if (item.engagements != null && !isNaN(item.engagements)) {
      totalEngagements += item.engagements;
      hasAnyEngagements = true;
    }
    if (item.conversions != null && !isNaN(item.conversions)) {
      totalConversions += item.conversions;
      hasAnyConversions = true;
    }
    if (item.revenue != null && !isNaN(item.revenue)) {
      totalRevenue += item.revenue;
      hasAnyRevenue = true;
    }
  }

  const raw: RawMetrics = {
    spend: hasAnySpend ? totalSpend : null,
    impressions: hasAnyImpressions ? totalImpressions : null,
    clicks: hasAnyClicks ? totalClicks : null,
    reach: hasAnyReach ? totalReach : null,
    engagements: hasAnyEngagements ? totalEngagements : null,
    conversions: hasAnyConversions ? totalConversions : null,
    revenue: hasAnyRevenue ? totalRevenue : null,
  };

  return computeMetrics(raw);
}
