import {
  RawMetrics,
  ComputedMetrics,
  AggregatedResult,
  LikeForLikeExclusion,
} from './types.js';
import {
  aggregateRawMetrics,
  calculateChange,
  calculateCtrChange,
} from './metrics.js';
import {
  CampaignReliabilityInput,
  ReliabilityOptions,
  classifyReliability,
} from './reliability.js';

export interface CampaignWithMetrics {
  campaign: CampaignReliabilityInput;
  current: RawMetrics;
  previous: RawMetrics;
}

/**
 * Aggregates campaign metrics for groups and overview KPIs.
 * 
 * Rules:
 * 1. Total sums all valid underlying raw metrics across applicable campaigns, then computes ratios.
 * 2. Like-for-like sums ONLY campaigns that are reliable in BOTH periods.
 * 3. Never averages ratios.
 * 4. Excluded campaigns are returned with specific reason codes and human-readable text.
 */
export function aggregateCampaigns(
  items: CampaignWithMetrics[],
  options: ReliabilityOptions = {}
): AggregatedResult {
  const allCurrentRaws: RawMetrics[] = [];
  const allPreviousRaws: RawMetrics[] = [];

  const lflCurrentRaws: RawMetrics[] = [];
  const lflPreviousRaws: RawMetrics[] = [];
  const excludedCampaigns: LikeForLikeExclusion[] = [];

  let delayedCount = 0;
  let deliveringCount = 0;

  for (const item of items) {
    const { campaign, current, previous } = item;
    const isDelivering = campaign.status === 'Active' || campaign.status === 'Learning';
    if (isDelivering) {
      deliveringCount++;
    }

    const isDelayed =
      campaign.syncStatus === 'delayed' ||
      campaign.platformSyncStatus === 'delayed';
    if (isDelayed) {
      delayedCount++;
    }

    // Add to total pool (unless sync failed entirely or no ad sets configured)
    if (campaign.syncStatus !== 'failed' && campaign.syncStatus !== 'noadsets') {
      allCurrentRaws.push(current);
      allPreviousRaws.push(previous);
    }

    // Reliability check for like-for-like inclusion
    const rel = classifyReliability(campaign, current, previous, options);

    if (rel.isReliable) {
      lflCurrentRaws.push(current);
      lflPreviousRaws.push(previous);
    } else {
      excludedCampaigns.push({
        campaignId: Number(campaign.id ?? 0),
        campaignName: campaign.name || `Campaign ${campaign.id}`,
        reasonCode: rel.reasonCode,
        reasonText: rel.reasonText,
      });
    }
  }

  const currentTotal = aggregateRawMetrics(allCurrentRaws);
  const previousTotal = aggregateRawMetrics(allPreviousRaws);

  const currentLfl = aggregateRawMetrics(lflCurrentRaws);
  const previousLfl = aggregateRawMetrics(lflPreviousRaws);

  const totalChanges = {
    spend: calculateChange(currentTotal.spend, previousTotal.spend),
    impressions: calculateChange(currentTotal.impressions, previousTotal.impressions),
    clicks: calculateChange(currentTotal.clicks, previousTotal.clicks),
    ctr: calculateCtrChange(currentTotal.ctr, previousTotal.ctr),
    cpc: calculateChange(currentTotal.cpc, previousTotal.cpc),
  };

  const lflChanges = {
    spend: calculateChange(currentLfl.spend, previousLfl.spend),
    impressions: calculateChange(currentLfl.impressions, previousLfl.impressions),
    clicks: calculateChange(currentLfl.clicks, previousLfl.clicks),
    ctr: calculateCtrChange(currentLfl.ctr, previousLfl.ctr),
    cpc: calculateChange(currentLfl.cpc, previousLfl.cpc),
  };

  const isProvisional = Boolean(
    options.currentPeriodEnd &&
      options.todayDate &&
      options.currentPeriodEnd >= options.todayDate
  );

  return {
    current: currentTotal,
    previous: previousTotal,
    changes: totalChanges,
    totalCampaignsCount: items.length,
    deliveringCampaignsCount: deliveringCount,
    likeForLike: {
      current: currentLfl,
      previous: previousLfl,
      changes: lflChanges,
      campaignsCount: lflCurrentRaws.length,
      excludedCampaigns,
    },
    hasDelayedData: delayedCount > 0,
    delayedCount,
    isProvisional,
  };
}
