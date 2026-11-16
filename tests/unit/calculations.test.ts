import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  calculateRelativeChange,
  calculatePercentagePoints,
  calculateCtrChange,
  aggregateRawMetrics,
} from '../../src/calculations/metrics.js';
import { aggregateCampaigns } from '../../src/calculations/aggregations.js';

describe('Calculation Module - Metric Formulas', () => {
  it('computes CTR, CPC, CPM correctly', () => {
    const raw = {
      spend: 2500,
      impressions: 100000,
      clicks: 2500,
    };
    const computed = computeMetrics(raw);
    expect(computed.ctr).toBeCloseTo(2.5, 4); // 2500 / 100000 * 100 = 2.5%
    expect(computed.cpc).toBeCloseTo(1.0, 4); // 2500 / 2500 = 1.0
    expect(computed.cpm).toBeCloseTo(25.0, 4); // 2500 / 100000 * 1000 = 25.0
  });

  it('computes engagement metrics, conversion metrics, and ROAS', () => {
    const raw = {
      spend: 10000,
      impressions: 50000,
      clicks: 1000,
      engagements: 2500,
      conversions: 100,
      revenue: 35000,
    };
    const computed = computeMetrics(raw);
    expect(computed.engagementRate).toBeCloseTo(5.0, 4); // 2500 / 50000 * 100 = 5%
    expect(computed.costPerEngagement).toBeCloseTo(4.0, 4); // 10000 / 2500 = 4.0
    expect(computed.conversionRate).toBeCloseTo(10.0, 4); // 100 / 1000 * 100 = 10%
    expect(computed.costPerConversion).toBeCloseTo(100.0, 4); // 10000 / 100 = 100
    expect(computed.roas).toBeCloseTo(3.5, 4); // 35000 / 10000 = 3.5x
  });

  it('handles zero and null denominators cleanly by returning null (never 0, NaN, or Infinity)', () => {
    const zeroRaw = {
      spend: 1000,
      impressions: 0,
      clicks: 0,
      engagements: 0,
      conversions: 0,
      revenue: 0,
    };
    const computed = computeMetrics(zeroRaw);
    expect(computed.ctr).toBeNull();
    expect(computed.cpc).toBeNull();
    expect(computed.cpm).toBeNull();
    expect(computed.engagementRate).toBeNull();
    expect(computed.costPerEngagement).toBeNull();
    expect(computed.conversionRate).toBeNull();
    expect(computed.costPerConversion).toBeNull();
    expect(computed.roas).toBe(0); // 0 revenue / 1000 spend = 0

    const nullRaw = {
      spend: null,
      impressions: null,
      clicks: null,
    };
    const nullComputed = computeMetrics(nullRaw);
    expect(nullComputed.ctr).toBeNull();
    expect(nullComputed.cpc).toBeNull();
    expect(nullComputed.cpm).toBeNull();
  });
});

describe('Calculation Module - Changes & Acceptance Criteria', () => {
  it('calculates relative change % and returns null on zero or missing baseline', () => {
    // Normal positive change: 100 -> 150 (+50%)
    expect(calculateRelativeChange(150, 100)).toBeCloseTo(50.0, 4);

    // Normal negative change: 100 -> 75 (-25%)
    expect(calculateRelativeChange(75, 100)).toBeCloseTo(-25.0, 4);

    // Zero baseline: must return null, NEVER Infinity or 0
    expect(calculateRelativeChange(100, 0)).toBeNull();

    // Missing baseline
    expect(calculateRelativeChange(100, null)).toBeNull();
    expect(calculateRelativeChange(null, 100)).toBeNull();
    expect(calculateRelativeChange(null, null)).toBeNull();
  });

  it('calculates percentage points change', () => {
    expect(calculatePercentagePoints(2.6, 3.5)).toBeCloseTo(-0.9, 4);
    expect(calculatePercentagePoints(5.0, 3.0)).toBeCloseTo(2.0, 4);
    expect(calculatePercentagePoints(null, 3.0)).toBeNull();
    expect(calculatePercentagePoints(3.0, null)).toBeNull();
  });

  it('Acceptance Check: Summer AC Awareness shows CTR 3.50% -> 2.60% (-0.90 pp, -25.7%)', () => {
    const prevCtr = 3.5;
    const curCtr = 2.6;
    const ctrChange = calculateCtrChange(curCtr, prevCtr);

    expect(ctrChange.percentagePoints).toBeCloseTo(-0.9, 2);
    expect(ctrChange.relativePct).toBeCloseTo(-25.714, 2);
    // Human display checks: -0.90 pp and -25.7%
    expect(ctrChange.percentagePoints?.toFixed(2)).toBe('-0.90');
    expect(ctrChange.relativePct?.toFixed(1)).toBe('-25.7');
  });
});

describe('Calculation Module - Aggregations & Never Averaging Ratios', () => {
  it('sums underlying totals then computes ratios, never averaging ratios', () => {
    // Campaign 1: high CTR, low volume: 100 clicks / 1,000 impr = 10% CTR, spend = 1,000 (CPC = 10)
    // Campaign 2: low CTR, high volume: 10 clicks / 10,000 impr = 0.1% CTR, spend = 1,000 (CPC = 100)
    const items = [
      { spend: 1000, impressions: 1000, clicks: 100 },
      { spend: 1000, impressions: 10000, clicks: 10 },
    ];

    const agg = aggregateRawMetrics(items);

    expect(agg.spend).toBe(2000);
    expect(agg.impressions).toBe(11000);
    expect(agg.clicks).toBe(110);

    // Summed ratio: 110 / 11000 * 100 = 1.00%
    expect(agg.ctr).toBeCloseTo(1.0, 4);
    // Notice that average of ratios would be (10 + 0.1) / 2 = 5.05%, which is WRONG:
    expect(agg.ctr).not.toBeCloseTo(5.05, 1);

    // CPC: 2000 / 110 = 18.18
    expect(agg.cpc).toBeCloseTo(2000 / 110, 2);
    // Notice that average of CPCs would be (10 + 100) / 2 = 55.00, which is WRONG:
    expect(agg.cpc).not.toBeCloseTo(55.0, 1);
  });

  it('like-for-like aggregates only include reliable campaigns and return excluded campaigns with reasons', () => {
    const items = [
      {
        campaign: {
          id: 1,
          name: 'Healthy Campaign',
          status: 'Active',
          syncStatus: 'ok',
          adSetCount: 3,
        },
        current: { spend: 5000, impressions: 50000, clicks: 1000 },
        previous: { spend: 4000, impressions: 40000, clicks: 800 },
      },
      {
        campaign: {
          id: 2,
          name: 'Delayed Campaign',
          status: 'Active',
          syncStatus: 'delayed',
          lastSync: 'Nov 14, 21:10',
          adSetCount: 2,
        },
        current: { spend: 3000, impressions: 30000, clicks: 600 },
        previous: { spend: 3000, impressions: 30000, clicks: 600 },
      },
      {
        campaign: {
          id: 3,
          name: 'Low Data Campaign',
          status: 'Active',
          syncStatus: 'ok',
          adSetCount: 2,
        },
        current: { spend: 200, impressions: 600, clicks: 10 },
        previous: { spend: 180, impressions: 500, clicks: 8 },
      },
    ];

    const result = aggregateCampaigns(items, {
      minImpressionsThreshold: 1000,
      todayDate: '2026-11-15',
      currentPeriodEnd: '2026-11-14',
    });

    // Total should include healthy, delayed, and low data campaigns
    expect(result.current.impressions).toBe(50000 + 30000 + 600);
    expect(result.totalCampaignsCount).toBe(3);

    // Like-for-like should ONLY include the Healthy Campaign (50,000 impr)
    expect(result.likeForLike.campaignsCount).toBe(1);
    expect(result.likeForLike.current.impressions).toBe(50000);
    expect(result.likeForLike.current.clicks).toBe(1000);
    expect(result.likeForLike.current.ctr).toBeCloseTo(2.0, 4);

    // Excluded campaigns must be identified with reasons
    expect(result.likeForLike.excludedCampaigns).toHaveLength(2);
    expect(result.likeForLike.excludedCampaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campaignId: 2,
          reasonCode: 'd',
        }),
        expect.objectContaining({
          campaignId: 3,
          reasonCode: 'l',
        }),
      ])
    );
  });
});
