import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app.js';
import { seedDatabase } from '../../src/db/seed.js';
import { closeDb } from '../../src/db/connection.js';

const DATES = 'current_start=2026-11-08&current_end=2026-11-14&previous_start=2026-11-01&previous_end=2026-11-07';

describe('Governance workflows (Product Decisions Note + Success Metrics)', () => {
  let app: FastifyInstance;
  const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, payload: payload as any, headers });
  const get = (url: string) => app.inject({ method: 'GET', url });

  beforeAll(async () => {
    await seedDatabase();
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    await closeDb();
  });

  describe('edge cases: drilldown', () => {
    it('campaign with no ad sets says so and never shows zero', async () => {
      const res = await get(`/api/campaigns/26?${DATES}`);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.adSets).toEqual([]);
      expect(body.message).toBe('No ad sets configured yet — metrics unavailable.');
      expect(body.campaign.current.spend).toBeNull();
    });

    it('failed-sync campaign has null (not zero) metrics at ad-set level', async () => {
      const body = (await get(`/api/campaigns/27?${DATES}`)).json();
      expect(body.campaign.reliability.status).toBe('sync_failed');
      for (const a of body.adSets) {
        expect(a.current.impressions).toBeNull();
        expect(a.current.spend).toBeNull();
      }
    });

    it('healthy campaign drills down to ad sets that sum to the campaign', async () => {
      const body = (await get(`/api/campaigns/0?${DATES}`)).json();
      expect(body.adSets.length).toBeGreaterThan(1);
      const sum = body.adSets.reduce((s: number, a: any) => s + (a.current.impressions ?? 0), 0);
      expect(sum).toBe(body.campaign.current.impressions);
    });

    it('404 for an unknown campaign', async () => {
      expect((await get(`/api/campaigns/9999?${DATES}`)).statusCode).toBe(404);
    });
  });

  describe('edge cases: groups', () => {
    it('re-adding a campaign to a group is blocked (409) so totals are never double-counted', async () => {
      const before = (await get(`/api/groups?${DATES}`)).json().groups.find((g: any) => g.id === 'g4');
      const res = await post('/api/groups/g4/campaigns', { campaignIds: [2] });
      expect(res.statusCode).toBe(409);
      expect(res.json().skipped[0].reason).toBe('duplicate');
      const after = (await get(`/api/groups?${DATES}`)).json().groups.find((g: any) => g.id === 'g4');
      expect(after.campaignCount).toBe(before.campaignCount);
      expect(after.combined.current.spend).toBe(before.combined.current.spend);
    });

    it('mixed add reports added + duplicate skipped', async () => {
      const res = await post('/api/groups/g5/campaigns', { campaignIds: [1, 1, 3] });
      expect(res.statusCode).toBe(200);
      const b = res.json();
      expect(b.added.sort()).toEqual([1, 3]);
      expect(b.skipped.some((s: any) => s.reason === 'duplicate' && s.campaignId === 1)).toBe(true);
    });

    it('ended campaign in a group is labelled and says whether it is in combined totals', async () => {
      const groups = (await get(`/api/groups?${DATES}`)).json().groups;
      const ended = groups.flatMap((g: any) => g.members).filter((m: any) => m.ended);
      expect(ended.length).toBeGreaterThan(0);
      for (const m of ended) expect(m.note).toMatch(/Ended — (not )?included in combined totals/);
    });

    it('failed-sync / no-ad-set campaigns are excluded from group totals, not read as zero', async () => {
      const created = (await post('/api/groups', { name: 'Edge group', campaignIds: [0, 26, 27] })).json();
      const g = (await get(`/api/groups?${DATES}`)).json().groups.find((x: any) => x.id === created.id);
      const byId = Object.fromEntries(g.members.map((m: any) => [m.campaignId, m]));
      expect(byId[26].inTotals).toBe(false);
      expect(byId[27].inTotals).toBe(false);
      expect(byId[27].note).toMatch(/Sync failed/);
      // combined equals the healthy campaign alone
      expect(g.combined.current.impressions).toBe(byId[0].current.impressions);
    });

    it('duplicate group names are rejected', async () => {
      expect((await post('/api/groups', { name: 'diwali performance' })).statusCode).toBe(409);
    });

    it('a group watched by an alert cannot be deleted silently', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/api/groups/g2' });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('edge cases: bulk actions', () => {
    it('refuses to act without explicit confirmation and returns the scope', async () => {
      const res = await post('/api/bulk/status', { action: 'pause', campaignIds: [0, 1], adSetIds: [] });
      expect(res.statusCode).toBe(409);
      expect(res.json().details.code).toBe('confirmation_required');
      expect(res.json().details.scope.campaigns).toBe(2);
    });

    it('partial ad-set selection only touches the selected ad sets, not the campaign', async () => {
      const detail = (await get(`/api/campaigns/0?${DATES}`)).json();
      const chosen = detail.adSets.slice(0, 2).map((a: any) => a.id);
      const res = await post('/api/bulk/status', { action: 'pause', campaignIds: [], adSetIds: chosen, confirm: true });
      expect(res.statusCode).toBe(200);
      expect(res.json().applied.filter((a: any) => a.type === 'adset')).toHaveLength(2);
      const after = (await get(`/api/campaigns/0?${DATES}`)).json();
      expect(after.campaign.status).not.toBe('Paused');
      expect(after.adSets.filter((a: any) => a.status === 'Paused').length).toBeGreaterThanOrEqual(2);
      // and can be undone
      await post('/api/bulk/status', { action: 'resume', campaignIds: [], adSetIds: chosen, confirm: true });
    });

    it('ended campaigns are skipped with a reason', async () => {
      const camps = (await get(`/api/campaigns?${DATES}&tab=Ended&size=50`)).json().items;
      expect(camps.length).toBeGreaterThan(0);
      const res = await post('/api/bulk/status', { action: 'pause', campaignIds: [camps[0].campaignId], adSetIds: [], confirm: true });
      expect(res.json().skipped[0].reason).toMatch(/Ended/);
      expect(res.json().applied).toHaveLength(0);
    });
  });

  describe('event tracking', () => {
    it('rejects events outside the tracking plan', async () => {
      expect((await post('/api/events', { event: 'page_view', sessionId: 's1' })).statusCode).toBe(400);
    });

    it('rejects client-forged system events', async () => {
      expect((await post('/api/events', { event: 'issue_detected', sessionId: 's1', issueId: 'c0' })).statusCode).toBe(400);
    });

    it('accepts export_clicked with its properties and strips emails from payloads', async () => {
      const res = await post('/api/events', {
        event: 'export_clicked',
        sessionId: 's-pii',
        source: 'campaigns',
        selectedCount: 3,
        payload: { sinceOpenedSec: 42, note: 'sent to someone@example.com' },
      });
      expect(res.statusCode).toBe(202);
      const { getDb } = await import('../../src/db/connection.js');
      const { raw } = await getDb();
      const r: any = await (raw as any).query("SELECT payload FROM analytics_events WHERE session_id = 's-pii'");
      const rows = r.rows ?? r;
      expect(rows[0].payload).not.toContain('someone@example.com');
      expect(rows[0].payload).toContain('[redacted]');
    });
  });

  describe('success metrics', () => {
    it('measures detect-to-investigate (A) and active-session (B) per issue', async () => {
      await post('/api/events', { event: 'governance_opened', sessionId: 'sess-A', source: 'overview' });
      const open = await post('/api/issues/c0/open', { sessionId: 'sess-A' });
      expect(open.statusCode).toBe(200);
      // opening again must not inflate the sample
      await post('/api/issues/c0/open', { sessionId: 'sess-A' });

      const m = (await get('/api/metrics/success?days=7')).json();
      expect(m.northStar.sampleSize).toBe(1);
      // c0 was detected 06:10, the simulated clock starts at 09:00 → A is at least ~170 minutes
      expect(m.northStar.detectToInvestigateMedianMinutes).toBeGreaterThan(170);
      expect(m.northStar.activeSessionMedianMinutes).toBeGreaterThanOrEqual(0);
      expect(m.northStar.activeSessionMedianMinutes).toBeLessThan(m.northStar.detectToInvestigateMedianMinutes);
      expect(m.drivers.weeklyActivePlanners).toBeGreaterThanOrEqual(1);
      expect(m.drivers.weeklyGovernanceActionRate).toBe(100);
    });

    it('does not invent a manual-workflow result without a pre-launch baseline', async () => {
      const m = (await get('/api/metrics/success')).json();
      expect(m.manualWorkflow.baselinePerWeek).toBeNull();
      expect(m.decision.manualWorkflowReduction.status).toBe('insufficient_data');
    });

    it('computes export reduction against a supplied baseline', async () => {
      const m = (await get('/api/metrics/success?export_baseline=10')).json();
      expect(m.manualWorkflow.reductionPct).not.toBeNull();
    });
  });

  describe('alerts', () => {
    const rule = {
      name: 'Test CPC rise',
      entityType: 'group',
      entityIds: ['g4'],
      metric: 'cpc',
      condition: 'rise',
      threshold: 1,
      comparisonPeriod: 'Previous 7 days',
      recipient: 'planner@acme.example',
      frequency: 'Daily summary',
    };

    it('dry-runs a rule without saving it', async () => {
      const before = (await get('/api/alerts')).json().rules.length;
      const res = await post('/api/alerts/test', rule);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.wouldTrigger.length + body.ok.length + body.excluded.length).toBeGreaterThan(0);
      expect((await get('/api/alerts')).json().rules.length).toBe(before);
    });

    it('recommends objective-aware metrics but allows overrides', async () => {
      const rec = (await get('/api/alerts/recommendations?entityType=group&entityIds=g4')).json();
      expect(rec.isMixed).toBe(false);
      expect(rec.recommended.map((r: any) => r.key)).toEqual(['leads', 'cpl', 'cvr']);
      // mixed objectives → no default pushed on the planner
      const mixed = (await get('/api/alerts/recommendations?entityType=campaigns&entityIds=0,2')).json();
      expect(mixed.isMixed).toBe(true);
      expect(mixed.recommended).toEqual([]);
      // override: a non-recommended metric is still accepted
      const res = await post('/api/alerts', { ...rule, name: 'Override rule', metric: 'ctr', threshold: 5 });
      expect(res.statusCode).toBe(201);
    });

    it('rejects invalid rules', async () => {
      expect((await post('/api/alerts', { ...rule, threshold: -3 })).statusCode).toBe(400);
      expect((await post('/api/alerts', { ...rule, metric: 'bogus' })).statusCode).toBe(400);
      expect((await post('/api/alerts', { ...rule, entityIds: ['nope'] })).statusCode).toBe(400);
    });

    it('one issue raises one alert: repeated evaluation is deduplicated', async () => {
      await post('/api/alerts', { ...rule, name: 'Always fires', threshold: 0.01 });
      const first = (await post('/api/alerts/evaluate')).json();
      const second = (await post('/api/alerts/evaluate')).json();
      expect(first.fired.length).toBeGreaterThan(0);
      expect(second.fired).toHaveLength(0);
      expect(second.suppressedDuplicates).toBeGreaterThanOrEqual(first.fired.length);
    });

    it('records planner verdicts for the false-positive guardrail, separate from dismissal', async () => {
      const alerts = (await get('/api/alerts')).json();
      const [t1, t2] = alerts.triggers.filter((t: any) => !t.provisional);
      expect(t1).toBeDefined();
      await post(`/api/alerts/triggers/${t1.id}/dismiss`, {}, { 'x-session-id': 'sess-A' });
      let m = (await get('/api/metrics/success')).json();
      // a dismissal alone is NOT a false positive
      expect(m.guardrail.alertFalsePositiveRate).toBeNull();
      expect(m.guardrail.alertDismissalRate).toBeGreaterThan(0);

      await post(`/api/alerts/triggers/${t1.id}/feedback`, { verdict: 'misleading' });
      if (t2) await post(`/api/alerts/triggers/${t2.id}/feedback`, { verdict: 'valid' });
      m = (await get('/api/metrics/success')).json();
      expect(m.guardrail.reviewedTriggeredAlerts).toBeGreaterThanOrEqual(1);
      expect(m.guardrail.alertFalsePositiveRate).toBeGreaterThan(0);
    });

    it('opening a triggered alert feeds the alert action rate', async () => {
      const created = (await post('/api/alerts', { ...rule, name: 'Action-rate rule', entityIds: ['g3'], threshold: 0.01 })).json();
      await post('/api/alerts/evaluate');
      const t = (await get('/api/alerts')).json().triggers.find((x: any) => x.ruleId === created.id && !x.provisional);
      expect(t).toBeDefined();
      await post(`/api/alerts/triggers/${t.id}/open`, {}, { 'x-session-id': 'sess-A' });
      const m = (await get('/api/metrics/success')).json();
      expect(m.drivers.eligibleTriggeredAlerts).toBeGreaterThan(0);
      expect(m.drivers.alertActionRate).toBeGreaterThan(0);
    });

    it('pausing a rule stops evaluation', async () => {
      const created = (await post('/api/alerts', { ...rule, name: 'To pause', threshold: 0.001 })).json();
      await post(`/api/alerts/${created.id}/status`, { status: 'Paused' });
      const summary = (await post('/api/alerts/evaluate')).json();
      expect(summary.fired.every((f: any) => f.ruleId !== created.id)).toBe(true);
    });
  });

  describe('issue lifecycle + activity', () => {
    it('resolving an issue removes it from open issues and logs activity', async () => {
      await post('/api/issues/b10/resolve', { sessionId: 'sess-A' });
      const ov = (await get(`/api/overview?${DATES}`)).json();
      expect(ov.issues.find((i: any) => i.id === 'b10')).toBeUndefined();
      const log = (await get('/api/activity')).json().items;
      expect(log[0].actionText).toMatch(/resolved|Resolved/);
    });

    it('404 for unknown issue', async () => {
      expect((await post('/api/issues/nope/open', { sessionId: 's' })).statusCode).toBe(404);
    });
  });
});
