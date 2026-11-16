import {
  ReliabilityStatus,
  RawMetrics,
} from './types.js';

export interface CampaignReliabilityInput {
  id?: number | string;
  name?: string;
  status: string; // 'Active' | 'Learning' | 'Paused' | 'Ended'
  syncStatus?: string | null; // 'ok' | 'delayed' | 'insufficient' | 'noadsets' | 'failed'
  lastSync?: string | null;
  adSetCount?: number | null;
  platformSyncStatus?: 'connected' | 'delayed' | 'failed';
}

export interface ReliabilityResult {
  status: ReliabilityStatus;
  isReliable: boolean;
  reasonCode: 'f' | 'n' | 'd' | 'l' | 'b' | '' | 'p' | 'm';
  reasonText: string;
  flagText: string;
}

export interface ReliabilityOptions {
  minImpressionsThreshold?: number; // default: 1000
  todayDate?: string; // e.g. '2026-11-15'
  currentPeriodEnd?: string; // e.g. '2026-11-14'
}

export const DEFAULT_MIN_IMPRESSIONS = 1000;
export const DEFAULT_TODAY_DATE = '2026-11-15';

/**
 * Single source of truth function for campaign and ad set reliability classification.
 * Used everywhere across backend APIs, calculations, issue detection, and alerts.
 */
export function classifyReliability(
  campaign: CampaignReliabilityInput,
  current: RawMetrics | null | undefined,
  previous: RawMetrics | null | undefined,
  options: ReliabilityOptions = {}
): ReliabilityResult {
  const minThreshold = options.minImpressionsThreshold ?? DEFAULT_MIN_IMPRESSIONS;
  const todayDate = options.todayDate ?? DEFAULT_TODAY_DATE;
  const currentEnd = options.currentPeriodEnd;
  const syncTime = campaign.lastSync || 'recently';

  // 1. Sync failed: platform or campaign sync failed
  if (
    campaign.syncStatus === 'failed' ||
    campaign.platformSyncStatus === 'failed'
  ) {
    return {
      status: 'sync_failed',
      isReliable: false,
      reasonCode: 'f',
      reasonText: `Sync failed (last successful sync ${syncTime}): data unavailable and excluded, never treated as zero.`,
      flagText: '✖ Sync failed',
    };
  }

  // 2. No ad sets configured
  if (
    campaign.syncStatus === 'noadsets' ||
    campaign.adSetCount === 0
  ) {
    return {
      status: 'no_ad_sets',
      isReliable: false,
      reasonCode: 'n',
      reasonText: 'No ad sets configured: metrics unavailable.',
      flagText: '⚠ No ad sets',
    };
  }

  // 3. Delayed platform or campaign sync
  if (
    campaign.syncStatus === 'delayed' ||
    campaign.platformSyncStatus === 'delayed'
  ) {
    return {
      status: 'delayed',
      isReliable: false,
      reasonCode: 'd',
      reasonText: `Platform sync delayed (last successful sync ${syncTime}): values may be incomplete.`,
      flagText: '⏱ Delayed',
    };
  }

  // 4. Provisional data (current period includes today)
  if (currentEnd && currentEnd >= todayDate) {
    return {
      status: 'provisional',
      isReliable: false,
      reasonCode: 'p',
      reasonText: 'Current period includes today: partial day; alerts are not evaluated.',
      flagText: '⚠ Provisional',
    };
  }

  const curImpr = current?.impressions;
  const prevImpr = previous?.impressions;

  // 5. No baseline (missing or zero previous impressions)
  if (prevImpr == null || prevImpr === 0) {
    return {
      status: 'no_baseline',
      isReliable: false,
      reasonCode: 'b',
      reasonText: 'Previous-period data is missing or zero: comparison unavailable.',
      flagText: '⚠ No baseline',
    };
  }

  // 6. Low data (impressions under threshold in either current or previous period)
  if (
    curImpr == null ||
    curImpr < minThreshold ||
    prevImpr < minThreshold
  ) {
    return {
      status: 'low_data',
      isReliable: false,
      reasonCode: 'l',
      reasonText: `Under ${minThreshold.toLocaleString('en-IN')} impressions in a period (illustrative assumption): CTR comparison suppressed.`,
      flagText: '⚠ Low data',
    };
  }

  // 7. Learning phase
  if (campaign.status === 'Learning') {
    return {
      status: 'learning',
      isReliable: false, // Comparisons are provisional during learning phase
      reasonCode: 'm',
      reasonText: 'Platform is optimising delivery: comparisons are provisional.',
      flagText: '◐ Learning',
    };
  }

  // 8. Complete and reliable
  return {
    status: 'complete',
    isReliable: true,
    reasonCode: '',
    reasonText: 'Complete and reliable data.',
    flagText: '✓ OK',
  };
}
