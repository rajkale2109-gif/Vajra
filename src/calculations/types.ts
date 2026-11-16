export type Platform = 'Meta' | 'Google';

export type Objective = 
  | 'Awareness'
  | 'Traffic'
  | 'Engagement'
  | 'Leads'
  | 'App Promotion'
  | 'Sales';

export type CampaignStatus = 'Active' | 'Learning' | 'Paused' | 'Ended';

export type ReliabilityStatus =
  | 'complete'
  | 'low_data'
  | 'no_baseline'
  | 'delayed'
  | 'sync_failed'
  | 'no_ad_sets'
  | 'learning'
  | 'provisional';

export type DataState = 'complete' | 'partial' | 'delayed' | 'missing';

export interface RawMetrics {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  reach?: number | null;
  engagements?: number | null;
  conversions?: number | null;
  revenue?: number | null;
}

export interface ComputedMetrics extends RawMetrics {
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  engagementRate: number | null;
  costPerEngagement: number | null;
  conversionRate: number | null;
  costPerConversion: number | null; // CPL, CPI, CPA
  roas: number | null;
}

export interface MetricChange {
  current: number | null;
  previous: number | null;
  relativePct: number | null; // (current - previous) / previous * 100, null if previous is 0 or null
}

export interface CtrChange extends MetricChange {
  percentagePoints: number | null; // current - previous
}

export interface CampaignComparison {
  campaignId: number;
  current: ComputedMetrics;
  previous: ComputedMetrics;
  changes: {
    spend: MetricChange;
    impressions: MetricChange;
    clicks: MetricChange;
    ctr: CtrChange;
    cpc: MetricChange;
    cpm: MetricChange;
    reach: MetricChange;
    engagements: MetricChange;
    conversions: MetricChange;
    revenue: MetricChange;
    roas: MetricChange;
  };
  reliability: {
    status: ReliabilityStatus;
    isReliable: boolean;
    reasonCode: 'f' | 'n' | 'd' | 'l' | 'b' | '' | 'p' | 'm';
    reasonText: string;
    flagText: string;
  };
}

export interface AggregatedTotals {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  engagements: number;
  conversions: number;
  revenue: number;
  count: number;
}

export interface LikeForLikeExclusion {
  campaignId: number;
  campaignName: string;
  reasonCode: string;
  reasonText: string;
}

export interface AggregatedResult {
  current: ComputedMetrics;
  previous: ComputedMetrics;
  changes: {
    spend: MetricChange;
    impressions: MetricChange;
    clicks: MetricChange;
    ctr: CtrChange;
    cpc: MetricChange;
  };
  totalCampaignsCount: number;
  deliveringCampaignsCount: number;
  likeForLike: {
    current: ComputedMetrics;
    previous: ComputedMetrics;
    changes: {
      spend: MetricChange;
      impressions: MetricChange;
      clicks: MetricChange;
      ctr: CtrChange;
      cpc: MetricChange;
    };
    campaignsCount: number;
    excludedCampaigns: LikeForLikeExclusion[];
  };
  hasDelayedData: boolean;
  delayedCount: number;
  isProvisional: boolean;
}
