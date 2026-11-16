import { Objective } from './types.js';

export interface MetricDefinition {
  key: string;
  label: string;
  unit: '%' | '₹' | 'n' | 'x';
  format: 'percentage' | 'currency' | 'number' | 'multiple';
  applicableObjectives?: Objective[]; // If specified, only applicable to these objectives
  description?: string;
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  impr: {
    key: 'impr',
    label: 'Impressions',
    unit: 'n',
    format: 'number',
    description: 'Times ads were displayed',
  },
  reach: {
    key: 'reach',
    label: 'Reach',
    unit: 'n',
    format: 'number',
    description: 'Unique individuals who saw ads',
  },
  cpm: {
    key: 'cpm',
    label: 'CPM',
    unit: '₹',
    format: 'currency',
    description: 'Cost per 1,000 impressions',
  },
  ctr: {
    key: 'ctr',
    label: 'CTR',
    unit: '%',
    format: 'percentage',
    description: 'Click-through rate (clicks ÷ impressions × 100)',
  },
  cpc: {
    key: 'cpc',
    label: 'CPC',
    unit: '₹',
    format: 'currency',
    description: 'Cost per click (spend ÷ clicks)',
  },
  clicks: {
    key: 'clicks',
    label: 'Clicks',
    unit: 'n',
    format: 'number',
    description: 'Total clicks on ads',
  },
  spend: {
    key: 'spend',
    label: 'Spend',
    unit: '₹',
    format: 'currency',
    description: 'Total advertising expenditure',
  },
  er: {
    key: 'er',
    label: 'Engagement rate',
    unit: '%',
    format: 'percentage',
    description: 'Engagements ÷ impressions × 100',
  },
  cpe: {
    key: 'cpe',
    label: 'Cost per engagement',
    unit: '₹',
    format: 'currency',
    description: 'Spend ÷ engagements',
  },
  leads: {
    key: 'leads',
    label: 'Leads',
    unit: 'n',
    format: 'number',
    applicableObjectives: ['Leads'],
    description: 'Lead form completions',
  },
  cpl: {
    key: 'cpl',
    label: 'Cost per lead',
    unit: '₹',
    format: 'currency',
    applicableObjectives: ['Leads'],
    description: 'Spend ÷ leads',
  },
  installs: {
    key: 'installs',
    label: 'Installs',
    unit: 'n',
    format: 'number',
    applicableObjectives: ['App Promotion'],
    description: 'Mobile app downloads/installations',
  },
  cpi: {
    key: 'cpi',
    label: 'Cost per install',
    unit: '₹',
    format: 'currency',
    applicableObjectives: ['App Promotion'],
    description: 'Spend ÷ installs',
  },
  purchases: {
    key: 'purchases',
    label: 'Purchases',
    unit: 'n',
    format: 'number',
    applicableObjectives: ['Sales'],
    description: 'Completed e-commerce transactions',
  },
  cpa: {
    key: 'cpa',
    label: 'Cost per acquisition',
    unit: '₹',
    format: 'currency',
    applicableObjectives: ['Sales'],
    description: 'Spend ÷ purchases',
  },
  roas: {
    key: 'roas',
    label: 'ROAS',
    unit: 'x',
    format: 'multiple',
    applicableObjectives: ['Sales'],
    description: 'Return on ad spend (revenue ÷ spend)',
  },
  cvr: {
    key: 'cvr',
    label: 'Conversion rate',
    unit: '%',
    format: 'percentage',
    applicableObjectives: ['Leads', 'App Promotion', 'Sales'],
    description: 'Conversions ÷ clicks × 100',
  },
};

export const OBJECTIVE_RECOMMENDED_METRICS: Record<Objective, string[]> = {
  Awareness: ['impr', 'reach', 'cpm'],
  Traffic: ['ctr', 'cpc', 'clicks'],
  Engagement: ['er', 'cpe'],
  Leads: ['leads', 'cpl', 'cvr'],
  'App Promotion': ['installs', 'cpi', 'cvr'],
  Sales: ['purchases', 'cpa', 'roas'],
};

/**
 * Returns recommended metrics for a given set of campaign objectives.
 * "Recommend by objective, never restrict."
 */
export function getRecommendedMetrics(objectives: Objective[]): {
  recommended: string[];
  isMixed: boolean;
} {
  const uniqueObjectives = [...new Set(objectives)];
  if (uniqueObjectives.length === 1) {
    const obj = uniqueObjectives[0];
    return {
      recommended: OBJECTIVE_RECOMMENDED_METRICS[obj] || [],
      isMixed: false,
    };
  }
  return {
    recommended: [],
    isMixed: true,
  };
}

/**
 * Checks whether a metric applies to a campaign's objective.
 * "Metrics that do not apply to the watched objectives are reported as 'not applicable', never evaluated as zero."
 */
export function isMetricApplicable(metricKey: string, objective: Objective): boolean {
  const def = METRIC_DEFINITIONS[metricKey];
  if (!def || !def.applicableObjectives) {
    return true; // Metric is generic (spend, impressions, clicks, ctr, cpc, etc.)
  }
  return def.applicableObjectives.includes(objective);
}
