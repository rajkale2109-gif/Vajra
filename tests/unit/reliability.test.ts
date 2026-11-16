import { describe, it, expect } from 'vitest';
import { classifyReliability } from '../../src/calculations/reliability.js';

describe('Reliability Module - Single Source of Truth Classification', () => {
  const baseCampaign = {
    id: 1,
    name: 'Test Campaign',
    status: 'Active',
    syncStatus: 'ok',
    adSetCount: 3,
    lastSync: 'Nov 15, 08:30',
  };

  const normalMetrics = {
    spend: 10000,
    impressions: 25000,
    clicks: 750,
  };

  it('classifies complete and reliable data correctly', () => {
    const res = classifyReliability(baseCampaign, normalMetrics, normalMetrics, {
      minImpressionsThreshold: 1000,
      todayDate: '2026-11-15',
      currentPeriodEnd: '2026-11-14',
    });
    expect(res.status).toBe('complete');
    expect(res.isReliable).toBe(true);
    expect(res.reasonCode).toBe('');
    expect(res.flagText).toBe('✓ OK');
  });

  it('classifies sync_failed on campaign or platform failure', () => {
    const failedCampaign = {
      ...baseCampaign,
      syncStatus: 'failed',
      lastSync: 'Nov 11, 18:30',
    };
    const res = classifyReliability(failedCampaign, null, null);
    expect(res.status).toBe('sync_failed');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('f');
    expect(res.flagText).toBe('✖ Sync failed');
    expect(res.reasonText).toContain('data unavailable and excluded, never treated as zero');
  });

  it('classifies no_ad_sets when ad set count is 0 or syncStatus is noadsets', () => {
    const noAdSetsCampaign = {
      ...baseCampaign,
      syncStatus: 'noadsets',
      adSetCount: 0,
    };
    const res = classifyReliability(noAdSetsCampaign, null, null);
    expect(res.status).toBe('no_ad_sets');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('n');
    expect(res.flagText).toBe('⚠ No ad sets');
  });

  it('classifies delayed when sync is delayed', () => {
    const delayedCampaign = {
      ...baseCampaign,
      syncStatus: 'delayed',
      lastSync: 'Nov 14, 21:10',
    };
    const res = classifyReliability(delayedCampaign, normalMetrics, normalMetrics);
    expect(res.status).toBe('delayed');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('d');
    expect(res.flagText).toBe('⏱ Delayed');
  });

  it('classifies provisional when current period includes today', () => {
    const res = classifyReliability(baseCampaign, normalMetrics, normalMetrics, {
      todayDate: '2026-11-15',
      currentPeriodEnd: '2026-11-15', // Includes today!
    });
    expect(res.status).toBe('provisional');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('p');
    expect(res.flagText).toBe('⚠ Provisional');
  });

  it('classifies no_baseline when previous period impressions is missing or zero', () => {
    const zeroPrevious = {
      spend: 0,
      impressions: 0,
      clicks: 0,
    };
    const res = classifyReliability(baseCampaign, normalMetrics, zeroPrevious, {
      currentPeriodEnd: '2026-11-14',
      todayDate: '2026-11-15',
    });
    expect(res.status).toBe('no_baseline');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('b');
    expect(res.flagText).toBe('⚠ No baseline');
  });

  it('evaluates the 1,000-impression boundary strictly (999 is low_data, 1000 is complete)', () => {
    // Exactly 999 current impressions -> low_data
    const boundary999 = {
      spend: 500,
      impressions: 999,
      clicks: 25,
    };
    const boundary1000 = {
      spend: 500,
      impressions: 1000,
      clicks: 25,
    };

    const res999 = classifyReliability(baseCampaign, boundary999, boundary1000, {
      minImpressionsThreshold: 1000,
      todayDate: '2026-11-15',
      currentPeriodEnd: '2026-11-14',
    });
    expect(res999.status).toBe('low_data');
    expect(res999.isReliable).toBe(false);
    expect(res999.reasonCode).toBe('l');
    expect(res999.flagText).toBe('⚠ Low data');

    // Exactly 1000 in both periods -> complete
    const res1000 = classifyReliability(baseCampaign, boundary1000, boundary1000, {
      minImpressionsThreshold: 1000,
      todayDate: '2026-11-15',
      currentPeriodEnd: '2026-11-14',
    });
    expect(res1000.status).toBe('complete');
    expect(res1000.isReliable).toBe(true);
  });

  it('classifies learning phase', () => {
    const learningCampaign = {
      ...baseCampaign,
      status: 'Learning',
    };
    const res = classifyReliability(learningCampaign, normalMetrics, normalMetrics, {
      currentPeriodEnd: '2026-11-14',
      todayDate: '2026-11-15',
    });
    expect(res.status).toBe('learning');
    expect(res.isReliable).toBe(false);
    expect(res.reasonCode).toBe('m');
    expect(res.flagText).toBe('◐ Learning');
  });
});
