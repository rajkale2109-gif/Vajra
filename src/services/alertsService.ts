import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { config } from '../config/index.js';
import { aggregateCampaigns } from '../calculations/aggregations.js';
import { calculateRelativeChange } from '../calculations/metrics.js';
import { METRIC_DEFINITIONS, getRecommendedMetrics, isMetricApplicable } from '../calculations/objectives.js';
import { ComputedMetrics, Objective } from '../calculations/types.js';
import { mailer } from '../mailer/index.js';
import { nowDisplay, nowIso, nowMs, parseTs } from './clock.js';
import { emit } from './eventsService.js';
import { CampaignWithComparison, DateRangeParams, metricsService } from './metricsService.js';
import { aggOptions, getCampaignDetail, HttpError, logActivity, toAggItems } from './workspaceService.js';

export const METRIC_FIELD: Record<string, keyof ComputedMetrics> = {
  spend: 'spend',
  impr: 'impressions',
  clicks: 'clicks',
  reach: 'reach',
  ctr: 'ctr',
  cpc: 'cpc',
  cpm: 'cpm',
  er: 'engagementRate',
  cpe: 'costPerEngagement',
  cvr: 'conversionRate',
  cpl: 'costPerConversion',
  cpi: 'costPerConversion',
  cpa: 'costPerConversion',
  leads: 'conversions',
  installs: 'conversions',
  purchases: 'conversions',
  roas: 'roas',
};

const PERIODS: Record<string, DateRangeParams> = {
  'Previous day': { currentStart: '2026-11-14', currentEnd: '2026-11-14', previousStart: '2026-11-13', previousEnd: '2026-11-13' },
  'Previous 7 days': { currentStart: '2026-11-08', currentEnd: '2026-11-14', previousStart: '2026-11-01', previousEnd: '2026-11-07' },
  'Previous 30 days': { currentStart: '2026-10-16', currentEnd: '2026-11-14', previousStart: '2026-09-16', previousEnd: '2026-10-15' },
  'Custom comparison': { currentStart: '2026-11-08', currentEnd: '2026-11-14', previousStart: '2026-11-01', previousEnd: '2026-11-07' },
};

export const ruleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  entityType: z.enum(['campaigns', 'group', 'adsets']),
  entityIds: z.array(z.union([z.string(), z.number()])).min(1),
  metric: z.string().refine((m) => m in METRIC_DEFINITIONS, 'Unknown metric'),
  condition: z.enum(['drop', 'rise', 'below', 'above']),
  threshold: z.number().positive().finite(),
  comparisonPeriod: z.enum(['Previous day', 'Previous 7 days', 'Previous 30 days', 'Custom comparison']).default('Previous 7 days'),
  recipient: z.string().email(),
  frequency: z.enum(['Immediate', 'Daily summary']).default('Daily summary'),
});
export type RuleInput = z.infer<typeof ruleInputSchema>;

export interface EntityResult {
  entityKey: string;
  label: string;
  state: 'breached' | 'ok' | 'excluded';
  value: number | null;
  provisional: boolean;
  /** why the entity could not be evaluated (never treated as zero) */
  reason: string;
  excludedCount: number;
  message: string;
}

const pctFmt = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;

function breach(rule: Pick<RuleInput, 'condition' | 'threshold'>, curValue: number | null, changePct: number | null) {
  if (rule.condition === 'drop') return changePct != null && changePct <= -rule.threshold;
  if (rule.condition === 'rise') return changePct != null && changePct >= rule.threshold;
  if (rule.condition === 'below') return curValue != null && curValue < rule.threshold;
  return curValue != null && curValue > rule.threshold;
}

const isChangeCond = (c: string) => c === 'drop' || c === 'rise';

function judge(
  rule: RuleInput,
  entityKey: string,
  label: string,
  cur: number | null,
  prev: number | null,
  provisional: boolean,
  excludedCount: number
): EntityResult {
  const changePct = calculateRelativeChange(cur, prev);
  if (isChangeCond(rule.condition) && changePct == null) {
    return { entityKey, label, state: 'excluded', value: null, provisional, reason: prev ? 'Insufficient data for comparison' : 'No baseline (previous value is zero or missing)', excludedCount, message: '' };
  }
  if (!isChangeCond(rule.condition) && cur == null) {
    return { entityKey, label, state: 'excluded', value: null, provisional, reason: 'Metric unavailable', excludedCount, message: '' };
  }
  const value = isChangeCond(rule.condition) ? changePct : cur;
  const hit = breach(rule, cur, changePct);
  const def = METRIC_DEFINITIONS[rule.metric];
  const shown = isChangeCond(rule.condition) ? pctFmt(value as number) : (value as number).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  return {
    entityKey,
    label,
    state: hit ? 'breached' : 'ok',
    value,
    provisional,
    reason: '',
    excludedCount,
    message: `${def?.label ?? rule.metric} ${isChangeCond(rule.condition) ? `changed ${shown}` : `is ${shown}`} (rule: ${rule.condition} ${rule.threshold}${isChangeCond(rule.condition) ? '%' : ''})${provisional ? ' — provisional data' : ''}`,
  };
}

/** Evaluates one rule against current data. Pure: persists nothing. */
export async function evaluateRule(accountId: string, rule: RuleInput): Promise<EntityResult[]> {
  const { db } = await getDb();
  const dates = PERIODS[rule.comparisonPeriod] ?? PERIODS['Previous 7 days'];
  const comparisons = await metricsService.getCampaignComparisons(accountId, dates);
  const byId = new Map(comparisons.map((c) => [c.campaignId, c]));
  const field = METRIC_FIELD[rule.metric];
  const results: EntityResult[] = [];

  const campaignReason = (c: CampaignWithComparison): { excluded: string | null; provisional: boolean } => {
    const code = c.reliability.reasonCode;
    if (c.status === 'Ended') return { excluded: 'Campaign has ended', provisional: false };
    if (c.status === 'Paused') return { excluded: 'Campaign is paused', provisional: false };
    if (code === 'f') return { excluded: 'Sync failed: excluded from alert evaluation, never read as zero', provisional: false };
    if (code === 'n') return { excluded: 'No ad sets configured yet — metrics unavailable', provisional: false };
    if (!isMetricApplicable(rule.metric, c.objective as Objective)) {
      return { excluded: `Not applicable to ${c.objective} campaigns`, provisional: false };
    }
    if (isChangeCond(rule.condition) && (code === 'l' || code === 'b')) {
      return { excluded: code === 'b' ? 'No baseline' : 'Insufficient data for comparison', provisional: false };
    }
    // delayed, learning, provisional-period → evaluate, but label as provisional
    return { excluded: null, provisional: code === 'd' || code === 'm' || code === 'p' };
  };

  if (rule.entityType === 'campaigns') {
    for (const raw of rule.entityIds) {
      const c = byId.get(Number(raw));
      if (!c) {
        results.push({ entityKey: String(raw), label: `Campaign ${raw}`, state: 'excluded', value: null, provisional: false, reason: 'Campaign not found', excludedCount: 0, message: '' });
        continue;
      }
      const { excluded, provisional } = campaignReason(c);
      if (excluded) {
        results.push({ entityKey: String(c.campaignId), label: c.name, state: 'excluded', value: null, provisional: false, reason: excluded, excludedCount: 0, message: '' });
        continue;
      }
      results.push(judge(rule, String(c.campaignId), c.name, c.current[field] as number | null, c.previous[field] as number | null, provisional, 0));
    }
  } else if (rule.entityType === 'group') {
    const groups = await db.select().from(schema.groups).where(and(eq(schema.groups.accountId, accountId), inArray(schema.groups.id, rule.entityIds.map(String))));
    const members = groups.length ? await db.select().from(schema.groupMembers).where(inArray(schema.groupMembers.groupId, groups.map((g) => g.id))) : [];
    for (const g of groups) {
      const camps = members.filter((m) => m.groupId === g.id).map((m) => byId.get(m.campaignId)).filter((c): c is CampaignWithComparison => !!c);
      const usable: CampaignWithComparison[] = [];
      let excludedCount = 0;
      let provisional = false;
      for (const c of camps) {
        const r = campaignReason(c);
        // paused/ended members still belong to the group; only data-quality exclusions apply to group totals
        if (r.excluded && c.status !== 'Paused' && c.status !== 'Ended') excludedCount++;
        else if (!r.excluded) {
          usable.push(c);
          provisional ||= r.provisional;
        }
      }
      if (!usable.length) {
        results.push({ entityKey: g.id, label: g.name, state: 'excluded', value: null, provisional: false, reason: camps.length ? 'No evaluable campaigns in group' : 'Group has no campaigns', excludedCount, message: '' });
        continue;
      }
      // % change on a group is like-for-like only; absolute values use all usable campaigns
      const agg = aggregateCampaigns(toAggItems(usable), aggOptions(dates));
      const curVal = agg.current[field] as number | null;
      const prevVal = isChangeCond(rule.condition) ? (agg.likeForLike.previous[field] as number | null) : (agg.previous[field] as number | null);
      const curForChange = isChangeCond(rule.condition) ? (agg.likeForLike.current[field] as number | null) : curVal;
      results.push(judge(rule, g.id, g.name, curForChange, prevVal, provisional || agg.hasDelayedData, excludedCount));
    }
  } else {
    // Ad-set-level: campaigns without ad sets / failed sync are excluded
    const adSetRows = await db.select().from(schema.adSets).where(inArray(schema.adSets.id, rule.entityIds.map(String)));
    const detailCache = new Map<number, Awaited<ReturnType<typeof getCampaignDetail>>>();
    for (const a of adSetRows) {
      const parent = byId.get(a.campaignId);
      if (!parent) continue;
      const pr = campaignReason(parent);
      if (pr.excluded) {
        results.push({ entityKey: a.id, label: `${parent.name} › ${a.name}`, state: 'excluded', value: null, provisional: false, reason: pr.excluded, excludedCount: 0, message: '' });
        continue;
      }
      if (!detailCache.has(a.campaignId)) detailCache.set(a.campaignId, await getCampaignDetail(accountId, a.campaignId, dates));
      const ad = detailCache.get(a.campaignId)!.adSets.find((x) => x.id === a.id);
      if (!ad) continue;
      results.push(judge(rule, a.id, `${parent.name} › ${a.name}`, ad.current[field] as number | null, ad.previous[field] as number | null, pr.provisional || ad.reliability.reasonCode === 'p', 0));
    }
  }
  return results;
}

/** Dry-run used by the "Test against current data" panel before a rule is saved. */
export async function testRule(accountId: string, rule: RuleInput) {
  const results = await evaluateRule(accountId, rule);
  return {
    wouldTrigger: results.filter((r) => r.state === 'breached'),
    ok: results.filter((r) => r.state === 'ok'),
    excluded: results.filter((r) => r.state === 'excluded'),
    note: 'Dry run — nothing was saved and no notification was sent.',
  };
}

async function describeEntities(accountId: string, rule: RuleInput): Promise<{ objectives: Objective[]; missing: number }> {
  const { db } = await getDb();
  let campaignIds: number[] = [];
  if (rule.entityType === 'campaigns') campaignIds = rule.entityIds.map(Number);
  else if (rule.entityType === 'group') {
    const m = await db.select().from(schema.groupMembers).where(inArray(schema.groupMembers.groupId, rule.entityIds.map(String)));
    campaignIds = m.map((x) => x.campaignId);
  } else {
    const a = await db.select().from(schema.adSets).where(inArray(schema.adSets.id, rule.entityIds.map(String)));
    campaignIds = a.map((x) => x.campaignId);
  }
  const rows = campaignIds.length
    ? await db.select().from(schema.campaigns).where(and(eq(schema.campaigns.accountId, accountId), inArray(schema.campaigns.id, campaignIds)))
    : [];
  return { objectives: rows.map((r) => r.objective as Objective), missing: Math.max(0, new Set(campaignIds).size - rows.length) };
}

/** Objective-aware defaults: recommend, never restrict. */
export async function recommendMetrics(accountId: string, entityType: RuleInput['entityType'], entityIds: Array<string | number>) {
  const { objectives } = await describeEntities(accountId, { entityType, entityIds } as RuleInput);
  const { recommended, isMixed } = getRecommendedMetrics(objectives);
  return {
    objectives: [...new Set(objectives)],
    isMixed,
    recommended: recommended.map((k) => ({ key: k, label: METRIC_DEFINITIONS[k]?.label ?? k })),
    allMetrics: Object.values(METRIC_DEFINITIONS).map((m) => ({
      key: m.key,
      label: m.label,
      unit: m.unit,
      applicableObjectives: m.applicableObjectives ?? null,
    })),
    note: isMixed
      ? 'Mixed or unknown objectives: no default recommendation. Choose the metric that matches your goal.'
      : 'Recommended for this objective. You can override with any metric and your own threshold.',
  };
}

export async function createRule(accountId: string, input: RuleInput) {
  const { db } = await getDb();
  const { objectives, missing } = await describeEntities(accountId, input);
  if (missing > 0) throw new HttpError(400, 'One or more selected entities do not exist');
  if (input.entityType === 'group') {
    const g = await db.select().from(schema.groups).where(and(eq(schema.groups.accountId, accountId), inArray(schema.groups.id, input.entityIds.map(String))));
    if (g.length !== new Set(input.entityIds.map(String)).size) throw new HttpError(400, 'One or more selected groups do not exist');
  }
  const warnings: string[] = [];
  if (objectives.length && !objectives.some((o) => isMetricApplicable(input.metric, o))) {
    warnings.push(`${METRIC_DEFINITIONS[input.metric].label} does not apply to the watched objective(s) (${[...new Set(objectives)].join(', ')}); this rule will not fire.`);
  }
  const id = `a${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  await db.insert(schema.alertRules).values({
    id,
    accountId,
    name: input.name,
    entityType: input.entityType,
    entityIds: JSON.stringify(input.entityIds.map(String)),
    metric: input.metric,
    condition: input.condition,
    threshold: String(input.threshold),
    comparisonPeriod: input.comparisonPeriod,
    recipient: input.recipient,
    frequency: input.frequency,
    status: 'Active',
    lastTriggeredAt: '—',
  });
  await logActivity(accountId, 'Alert', `Alert "${input.name}" created`, input.name);
  return { id, warnings };
}

export function ruleFromRow(r: typeof schema.alertRules.$inferSelect): RuleInput {
  return {
    name: r.name,
    entityType: r.entityType as RuleInput['entityType'],
    entityIds: JSON.parse(r.entityIds),
    metric: r.metric,
    condition: r.condition as RuleInput['condition'],
    threshold: Number(r.threshold),
    comparisonPeriod: r.comparisonPeriod as RuleInput['comparisonPeriod'],
    recipient: r.recipient,
    frequency: r.frequency as RuleInput['frequency'],
  };
}

export async function setRuleStatus(accountId: string, ruleId: string, status: 'Active' | 'Paused') {
  const { db } = await getDb();
  const [rule] = await db.select().from(schema.alertRules).where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.accountId, accountId)));
  if (!rule) throw new HttpError(404, 'Alert rule not found');
  await db.update(schema.alertRules).set({ status, updatedAt: new Date() }).where(eq(schema.alertRules.id, ruleId));
  await logActivity(accountId, 'Alert', `Alert "${rule.name}" ${status === 'Paused' ? 'paused' : 'resumed'}`, rule.name);
}

export async function deleteRule(accountId: string, ruleId: string) {
  const { db } = await getDb();
  const [rule] = await db.select().from(schema.alertRules).where(and(eq(schema.alertRules.id, ruleId), eq(schema.alertRules.accountId, accountId)));
  if (!rule) throw new HttpError(404, 'Alert rule not found');
  await db.delete(schema.alertRules).where(eq(schema.alertRules.id, ruleId));
  await logActivity(accountId, 'Alert', `Alert "${rule.name}" deleted`, rule.name);
}

export interface EvaluationSummary {
  evaluatedRules: number;
  fired: Array<{ triggerId: number; ruleId: string; entity: string; provisional: boolean }>;
  suppressedDuplicates: number;
  suppressedCooldown: number;
  recovered: number;
}

/**
 * Evaluates every active rule. One issue raises one alert:
 *  - a still-breached entity with an open/dismissed trigger is a duplicate (suppressed);
 *  - when the breach clears the trigger is "recovered" (re-armed);
 *  - a new breach inside the cooldown after the previous trigger is suppressed.
 * Provisional triggers are stored and labelled but never emailed or counted as eligible.
 */
export async function evaluateAllRules(accountId: string, userId: string): Promise<EvaluationSummary> {
  const { db } = await getDb();
  const rules = await db.select().from(schema.alertRules).where(and(eq(schema.alertRules.accountId, accountId), eq(schema.alertRules.status, 'Active')));
  const summary: EvaluationSummary = { evaluatedRules: rules.length, fired: [], suppressedDuplicates: 0, suppressedCooldown: 0, recovered: 0 };
  const cooldownMs = config.ALERT_COOLDOWN_HOURS * 3600e3;

  for (const row of rules) {
    const rule = ruleFromRow(row);
    const results = await evaluateRule(accountId, rule);
    const existing = await db.select().from(schema.alertTriggers).where(eq(schema.alertTriggers.ruleId, row.id)).orderBy(desc(schema.alertTriggers.id));

    for (const r of results) {
      if (r.state === 'excluded') continue; // failed/insufficient data: no trigger, no recovery
      const key = `${row.id}:${rule.entityType}:${r.entityKey}`;
      const latest = existing.find((t) => t.triggerKey === key);
      const live = latest && latest.status !== 'recovered';

      if (r.state === 'ok') {
        if (live) {
          await db.update(schema.alertTriggers).set({ status: 'recovered' }).where(eq(schema.alertTriggers.id, latest!.id));
          summary.recovered++;
        }
        continue;
      }
      // breached
      if (live) {
        summary.suppressedDuplicates++;
        continue;
      }
      if (latest && latest.triggeredAt && nowMs() - parseTs(latest.triggeredAt) < cooldownMs) {
        summary.suppressedCooldown++;
        continue;
      }
      const ts = nowIso();
      const [created] = await db
        .insert(schema.alertTriggers)
        .values({
          ruleId: row.id,
          triggerKey: key,
          observedValue: String(r.value ?? 0),
          periodCurrentStart: PERIODS[row.comparisonPeriod]?.currentStart ?? '',
          periodCurrentEnd: PERIODS[row.comparisonPeriod]?.currentEnd ?? '',
          periodPreviousStart: PERIODS[row.comparisonPeriod]?.previousStart ?? '',
          periodPreviousEnd: PERIODS[row.comparisonPeriod]?.previousEnd ?? '',
          excludedCount: r.excludedCount,
          status: 'open',
          provisional: r.provisional,
          entityLabel: r.label,
          message: r.message,
          triggeredAt: ts,
        })
        .returning();
      await db.update(schema.alertRules).set({ lastTriggeredAt: nowDisplay(), cooldownUntil: new Date(nowMs() + cooldownMs).toISOString().slice(0, 19) }).where(eq(schema.alertRules.id, row.id));
      summary.fired.push({ triggerId: created.id, ruleId: row.id, entity: r.label, provisional: r.provisional });
      await emit(
        { accountId, userId },
        {
          event: 'alert_triggered',
          sessionId: 'system',
          alertId: row.id,
          groupId: rule.entityType === 'group' ? r.entityKey : undefined,
          campaignId: rule.entityType === 'campaigns' ? Number(r.entityKey) : undefined,
          dataState: r.provisional ? 'provisional' : 'complete',
          source: 'alert_engine',
          payload: { triggerId: created.id, triggerKey: key },
        }
      );
      if (row.frequency === 'Immediate' && !r.provisional) {
        mailer
          .sendEmail({ to: row.recipient, subject: `Vajra alert: ${row.name}`, text: `${r.label}: ${r.message}` })
          .catch((e) => console.warn('alert email failed', e));
      }
    }
  }
  return summary;
}

export async function listAlerts(accountId: string) {
  const { db } = await getDb();
  const rules = await db.select().from(schema.alertRules).where(eq(schema.alertRules.accountId, accountId));
  const triggers = rules.length
    ? await db.select().from(schema.alertTriggers).where(inArray(schema.alertTriggers.ruleId, rules.map((r) => r.id))).orderBy(desc(schema.alertTriggers.id))
    : [];
  const groups = await db.select().from(schema.groups).where(eq(schema.groups.accountId, accountId));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  return {
    rules: rules.map((r) => {
      const ids = JSON.parse(r.entityIds) as string[];
      const own = triggers.filter((t) => t.ruleId === r.id);
      return {
        id: r.id,
        name: r.name,
        entityType: r.entityType,
        entityIds: ids,
        entityLabel: r.entityType === 'group' ? ids.map((i) => groupName.get(i) ?? i).join(', ') : `${ids.length} ${r.entityType === 'adsets' ? 'ad set(s)' : 'campaign(s)'}`,
        metric: r.metric,
        metricLabel: METRIC_DEFINITIONS[r.metric]?.label ?? r.metric,
        condition: r.condition,
        threshold: Number(r.threshold),
        comparisonPeriod: r.comparisonPeriod,
        recipient: r.recipient,
        frequency: r.frequency,
        status: r.status,
        lastTriggeredAt: r.lastTriggeredAt,
        openTriggers: own.filter((t) => t.status === 'open' || t.status === 'opened').length,
      };
    }),
    triggers: triggers.map((t) => ({
      id: t.id,
      ruleId: t.ruleId,
      ruleName: rules.find((r) => r.id === t.ruleId)?.name ?? t.ruleId,
      entityLabel: t.entityLabel,
      message: t.message,
      status: t.status,
      provisional: t.provisional,
      feedback: t.feedback,
      triggeredAt: t.triggeredAt,
      excludedCount: t.excludedCount,
      period: `${t.periodCurrentStart} – ${t.periodCurrentEnd} vs ${t.periodPreviousStart} – ${t.periodPreviousEnd}`,
    })),
  };
}

async function getTrigger(accountId: string, triggerId: number) {
  const { db } = await getDb();
  const [t] = await db.select().from(schema.alertTriggers).where(eq(schema.alertTriggers.id, triggerId));
  if (!t) throw new HttpError(404, 'Alert trigger not found');
  const [rule] = await db.select().from(schema.alertRules).where(and(eq(schema.alertRules.id, t.ruleId), eq(schema.alertRules.accountId, accountId)));
  if (!rule) throw new HttpError(404, 'Alert trigger not found');
  return { db, t, rule };
}

export async function openTrigger(accountId: string, userId: string, triggerId: number, sessionId: string) {
  const { db, t, rule } = await getTrigger(accountId, triggerId);
  if (t.status === 'open') await db.update(schema.alertTriggers).set({ status: 'opened' }).where(eq(schema.alertTriggers.id, triggerId));
  await emit({ accountId, userId }, { event: 'alert_opened', sessionId, alertId: rule.id, dataState: t.provisional ? 'provisional' : 'complete', source: 'alerts_page', payload: { triggerId, triggerKey: t.triggerKey } });
  return { ok: true };
}

export async function dismissTrigger(accountId: string, userId: string, triggerId: number, sessionId: string) {
  const { db, t, rule } = await getTrigger(accountId, triggerId);
  await db.update(schema.alertTriggers).set({ status: 'dismissed' }).where(eq(schema.alertTriggers.id, triggerId));
  await emit({ accountId, userId }, { event: 'alert_dismissed', sessionId, alertId: rule.id, source: 'alerts_page', payload: { triggerId } });
  await logActivity(accountId, 'Alert', `Alert trigger dismissed`, rule.name);
  return { ok: true };
}

/**
 * False-positive review. Classification needs a look at the underlying data and the rule,
 * so it is an explicit planner verdict, never inferred from a dismissal.
 */
export async function reviewTrigger(accountId: string, userId: string, triggerId: number, verdict: 'valid' | 'misleading' | 'not_actionable', sessionId: string) {
  const { db, t, rule } = await getTrigger(accountId, triggerId);
  await db.update(schema.alertTriggers).set({ feedback: verdict }).where(eq(schema.alertTriggers.id, triggerId));
  await emit({ accountId, userId }, { event: 'alert_feedback_submitted', sessionId, alertId: rule.id, source: 'alerts_page', payload: { triggerId, verdict } });
  return { ok: true, id: t.id, verdict };
}
