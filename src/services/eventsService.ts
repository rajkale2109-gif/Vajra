import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { config } from '../config/index.js';
import { nowIso, nowMs, parseTs } from './clock.js';

/**
 * Tracking plan (Success Metrics note §04 plus supporting product events).
 * The first 12 are the measurement events; the rest give context to usage.
 */
export const CORE_EVENTS = [
  'governance_opened',
  'issue_detected',
  'issue_surfaced',
  'issue_opened',
  'issue_resolved',
  'group_created',
  'group_opened',
  'alert_created',
  'alert_triggered',
  'alert_opened',
  'alert_dismissed',
  'export_clicked',
] as const;

export const SUPPORT_EVENTS = [
  'campaign_opened',
  'period_changed',
  'bulk_selected',
  'bulk_action_confirmed',
  'bulk_action_cancelled',
  'group_campaign_added',
  'group_add_blocked_duplicate',
  'alert_tested',
  'alert_feedback_submitted',
  'issue_dismissed',
] as const;

export const ALL_EVENTS = [...CORE_EVENTS, ...SUPPORT_EVENTS] as const;
export type EventName = (typeof ALL_EVENTS)[number];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/** Strip anything email-like from free text so analytics never carries PII. */
export function scrubPii<T>(value: T): T {
  if (typeof value === 'string') return value.replace(EMAIL_RE, '[redacted]') as unknown as T;
  if (Array.isArray(value)) return value.map(scrubPii) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubPii(v)])) as T;
  }
  return value;
}

export const eventInputSchema = z.object({
  event: z.enum(ALL_EVENTS),
  sessionId: z.string().min(1).max(64),
  source: z.string().max(64).optional(),
  campaignId: z.number().int().optional(),
  adSetId: z.string().max(64).optional(),
  groupId: z.string().max(64).optional(),
  alertId: z.string().max(64).optional(),
  issueId: z.string().max(64).optional(),
  objective: z.string().max(40).optional(),
  platform: z.string().max(20).optional(),
  severity: z.string().max(20).optional(),
  dataState: z.string().max(30).optional(),
  selectedCount: z.number().int().min(0).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type EventInput = z.infer<typeof eventInputSchema>;

export interface EventContext {
  accountId: string;
  userId: string;
}

/** Records one event; the server stamps the timestamp so clients cannot skew the metrics. */
export async function recordEvent(ctx: EventContext, input: EventInput, tsOverride?: string): Promise<void> {
  const { db } = await getDb();
  await db.insert(schema.analyticsEvents).values({
    event: input.event,
    ts: tsOverride ?? nowIso(),
    accountId: ctx.accountId,
    userId: ctx.userId,
    sessionId: input.sessionId,
    source: input.source ?? null,
    campaignId: input.campaignId ?? null,
    adSetId: input.adSetId ?? null,
    groupId: input.groupId ?? null,
    alertId: input.alertId ?? null,
    issueId: input.issueId ?? null,
    objective: input.objective ?? null,
    platform: input.platform ?? null,
    severity: input.severity ?? null,
    dataState: input.dataState ?? null,
    selectedCount: input.selectedCount ?? null,
    payload: input.payload ? JSON.stringify(scrubPii(input.payload)) : null,
  });
}

/** Fire-and-forget safe variant for server-side emission inside other flows. */
export async function emit(ctx: EventContext, input: EventInput): Promise<void> {
  try {
    await recordEvent(ctx, input);
  } catch (err) {
    console.warn('analytics emit failed', err);
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const round1 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10) / 10);

export interface SuccessMetrics {
  window: { days: number; from: string; to: string };
  northStar: {
    name: string;
    medianMinutes: number | null; // A: detect-to-investigate
    sampleSize: number;
    detectToInvestigateMedianMinutes: number | null; // A
    activeSessionMedianMinutes: number | null; // B
    activeSessionSampleSize: number;
  };
  drivers: {
    weeklyActivePlanners: number;
    weeklyGovernanceActionRate: number | null;
    groupAdoptionRate: number | null;
    alertActionRate: number | null;
    eligibleTriggeredAlerts: number;
  };
  guardrail: {
    alertFalsePositiveRate: number | null;
    reviewedTriggeredAlerts: number;
    misleadingAlerts: number;
    alertDismissalRate: number | null; // diagnostic only, NOT a false-positive proxy
  };
  manualWorkflow: {
    exportClicks: number;
    exportsPerWeek: number;
    baselinePerWeek: number | null;
    reductionPct: number | null;
  };
  decision: {
    alertQuality: DecisionItem;
    workflowAdoption: DecisionItem;
    manualWorkflowReduction: DecisionItem;
    overall: 'continue' | 'investigate' | 'insufficient_data';
  };
  /** Proposed thresholds, exposed so charts can draw the target line next to the measured value. */
  thresholds: {
    falsePositiveRateLimit: number;
    alertActionRateFloor: number;
    workflowAdoptionFloor: number;
    exportReductionTarget: number;
  };
  methodology: string;
}

export interface DecisionItem {
  status: 'ok' | 'investigate' | 'insufficient_data';
  detail: string;
}

const MEANINGFUL = new Set([
  'issue_opened',
  'group_created',
  'alert_created',
  'alert_opened',
  'alert_dismissed',
  'issue_resolved',
]);

/**
 * Computes the one-page Success Metrics framework from recorded events.
 * - North Star A: issue_opened.ts - issue_detected.ts (same issue id), median.
 * - B: issue_opened.ts - governance_opened.ts (same session), median.
 * Only each issue's first investigation counts, so repeat opens do not inflate the sample.
 */
export async function computeSuccessMetrics(
  accountId: string,
  opts: { days?: number; exportBaselinePerWeek?: number } = {}
): Promise<SuccessMetrics> {
  const { db } = await getDb();
  const days = opts.days ?? 7;
  const toMs = nowMs();
  const fromMs = toMs - days * 864e5;
  const fromIso = new Date(fromMs).toISOString().slice(0, 19);
  const toIso = new Date(toMs).toISOString().slice(0, 19);

  const events = await db
    .select()
    .from(schema.analyticsEvents)
    .where(eq(schema.analyticsEvents.accountId, accountId));

  // The window is applied to usage events; issue_detected is looked up regardless of window.
  const inWindow = events.filter((e) => parseTs(e.ts) >= fromMs && parseTs(e.ts) <= toMs + 1000);

  // A: detect → investigate
  const detectedAt = new Map<string, number>();
  for (const e of events) {
    if (e.event === 'issue_detected' && e.issueId) {
      const t = parseTs(e.ts);
      const prev = detectedAt.get(e.issueId);
      if (prev == null || t < prev) detectedAt.set(e.issueId, t);
    }
  }
  const firstOpened = new Map<string, typeof events[number]>();
  for (const e of inWindow.filter((x) => x.event === 'issue_opened' && x.issueId)) {
    const prev = firstOpened.get(e.issueId!);
    if (!prev || parseTs(e.ts) < parseTs(prev.ts)) firstOpened.set(e.issueId!, e);
  }
  const aVals: number[] = [];
  const bVals: number[] = [];
  const govOpenedBySession = new Map<string, number[]>();
  for (const e of events.filter((x) => x.event === 'governance_opened')) {
    const arr = govOpenedBySession.get(e.sessionId) ?? [];
    arr.push(parseTs(e.ts));
    govOpenedBySession.set(e.sessionId, arr);
  }
  for (const [issueId, op] of firstOpened) {
    const opened = parseTs(op.ts);
    const det = detectedAt.get(issueId);
    if (det != null && opened >= det) aVals.push((opened - det) / 60000);
    const starts = (govOpenedBySession.get(op.sessionId) ?? []).filter((t) => t <= opened);
    if (starts.length) bVals.push((opened - Math.max(...starts)) / 60000);
  }

  // Drivers
  const governanceUsers = new Set(inWindow.filter((e) => e.event === 'governance_opened').map((e) => e.userId));
  const meaningfulUsers = new Set(inWindow.filter((e) => MEANINGFUL.has(e.event)).map((e) => e.userId));
  const active = governanceUsers.size;
  const meaningful = [...meaningfulUsers].filter((u) => governanceUsers.has(u)).length;

  const groupUsers = new Set<string>();
  for (const u of governanceUsers) {
    const created = inWindow.filter((e) => e.userId === u && e.event === 'group_created').map((e) => parseTs(e.ts));
    const opened = inWindow.filter((e) => e.userId === u && e.event === 'group_opened').map((e) => parseTs(e.ts));
    if (created.length && opened.some((o) => o > Math.min(...created))) groupUsers.add(u);
  }
  const groupOrAlertUsers = new Set(
    inWindow
      .filter((e) => ['group_created', 'group_opened', 'alert_created', 'alert_opened'].includes(e.event))
      .map((e) => e.userId)
  );
  const adoptionUsers = [...groupOrAlertUsers].filter((u) => governanceUsers.has(u)).length;

  // Alerts: eligible = triggered, not provisional, not on failed/missing data
  const triggers = await db
    .select({
      id: schema.alertTriggers.id,
      triggerKey: schema.alertTriggers.triggerKey,
      provisional: schema.alertTriggers.provisional,
      feedback: schema.alertTriggers.feedback,
      status: schema.alertTriggers.status,
      triggeredAt: schema.alertTriggers.triggeredAt,
      ruleId: schema.alertTriggers.ruleId,
    })
    .from(schema.alertTriggers)
    .innerJoin(schema.alertRules, eq(schema.alertRules.id, schema.alertTriggers.ruleId))
    .where(eq(schema.alertRules.accountId, accountId));

  const eligible = triggers.filter((t) => !t.provisional && (!t.triggeredAt || parseTs(t.triggeredAt) >= fromMs));
  const openedAlertTriggerIds = new Set<string>();
  for (const e of inWindow.filter((x) => x.event === 'alert_opened')) {
    try {
      const p = e.payload ? JSON.parse(e.payload) : {};
      if (p.triggerId != null) openedAlertTriggerIds.add(String(p.triggerId));
    } catch {
      /* ignore malformed payload */
    }
  }
  const investigated = eligible.filter((t) => openedAlertTriggerIds.has(String(t.id))).length;
  const dismissedCount = eligible.filter((t) => t.status === 'dismissed').length;

  const reviewed = triggers.filter((t) => t.feedback != null);
  const misleading = reviewed.filter((t) => t.feedback === 'misleading' || t.feedback === 'not_actionable').length;

  // Manual workflow
  const exportClicks = inWindow.filter((e) => e.event === 'export_clicked').length;
  const exportsPerWeek = (exportClicks / days) * 7;
  const baseline = opts.exportBaselinePerWeek ?? config.EXPORT_BASELINE_PER_WEEK ?? null;
  const reduction = baseline && baseline > 0 ? ((baseline - exportsPerWeek) / baseline) * 100 : null;

  const fpRate = pct(misleading, reviewed.length);
  const alertAction = pct(investigated, eligible.length);
  const adoption = pct(adoptionUsers, active);

  const alertQuality: DecisionItem =
    fpRate == null && alertAction == null
      ? { status: 'insufficient_data', detail: 'No reviewed or eligible triggered alerts yet.' }
      : (fpRate != null && fpRate > config.FALSE_POSITIVE_RATE_LIMIT) ||
          (alertAction != null && alertAction < config.ALERT_ACTION_RATE_FLOOR)
        ? {
            status: 'investigate',
            detail: `False-positive rate above ${config.FALSE_POSITIVE_RATE_LIMIT}% or alert action rate below ${config.ALERT_ACTION_RATE_FLOOR}%: review thresholds, objective-aware defaults and notification logic.`,
          }
        : { status: 'ok', detail: 'Alert false-positive rate and action rate are within the proposed thresholds.' };

  const workflowAdoption: DecisionItem =
    adoption == null
      ? { status: 'insufficient_data', detail: 'No weekly active planners recorded.' }
      : adoption < config.WORKFLOW_ADOPTION_FLOOR
        ? { status: 'investigate', detail: `Fewer than ${config.WORKFLOW_ADOPTION_FLOOR}% of weekly active planners use Groups or Alerts: review onboarding, discoverability and workflow friction.` }
        : { status: 'ok', detail: 'Groups/Alerts adoption meets the proposed floor.' };

  const manualWorkflowReduction: DecisionItem =
    reduction == null
      ? { status: 'insufficient_data', detail: 'No pre-launch export baseline set (EXPORT_BASELINE_PER_WEEK). Baselines must be established before launch.' }
      : reduction < config.EXPORT_REDUCTION_TARGET
        ? { status: 'investigate', detail: `Morning CSV export activity fell ${round1(reduction)}% vs baseline (target ${config.EXPORT_REDUCTION_TARGET}%): planners may still rely on spreadsheets.` }
        : { status: 'ok', detail: `Morning CSV export activity fell ${round1(reduction)}% vs baseline.` };

  const items = [alertQuality, workflowAdoption, manualWorkflowReduction];
  const overall = items.some((i) => i.status === 'investigate')
    ? 'investigate'
    : items.every((i) => i.status === 'ok')
      ? 'continue'
      : 'insufficient_data';

  const aMedian = median(aVals);
  return {
    window: { days, from: fromIso, to: toIso },
    northStar: {
      name: 'Median time to investigate an actionable campaign issue',
      medianMinutes: round1(aMedian),
      sampleSize: aVals.length,
      detectToInvestigateMedianMinutes: round1(aMedian),
      activeSessionMedianMinutes: round1(median(bVals)),
      activeSessionSampleSize: bVals.length,
    },
    drivers: {
      weeklyActivePlanners: active,
      weeklyGovernanceActionRate: round1(pct(meaningful, active)),
      groupAdoptionRate: round1(pct(groupUsers.size, active)),
      alertActionRate: round1(alertAction),
      eligibleTriggeredAlerts: eligible.length,
    },
    guardrail: {
      alertFalsePositiveRate: round1(fpRate),
      reviewedTriggeredAlerts: reviewed.length,
      misleadingAlerts: misleading,
      alertDismissalRate: round1(pct(dismissedCount, eligible.length)),
    },
    manualWorkflow: {
      exportClicks,
      exportsPerWeek: round1(exportsPerWeek) ?? 0,
      baselinePerWeek: baseline,
      reductionPct: round1(reduction),
    },
    decision: { alertQuality, workflowAdoption, manualWorkflowReduction, overall },
    thresholds: {
      falsePositiveRateLimit: config.FALSE_POSITIVE_RATE_LIMIT,
      alertActionRateFloor: config.ALERT_ACTION_RATE_FLOOR,
      workflowAdoptionFloor: config.WORKFLOW_ADOPTION_FLOOR,
      exportReductionTarget: config.EXPORT_REDUCTION_TARGET,
    },
    methodology:
      'Proposed product metrics. Thresholds are initial proposals, not industry benchmarks; baselines must be established before launch and targets validated with pilot data. Alert dismissal is a diagnostic, not a false-positive measure: false positives require reviewing the underlying data and rule.',
  };
}

/** Backfills issue_detected events for seeded issues (detection happened before the planner opened Governance). */
export async function backfillIssueDetected(
  accountId: string,
  userId: string,
  rows: Array<{ id: string; campaignId: number; detectedAtIso: string; severity: string }>
): Promise<void> {
  for (const r of rows) {
    await recordEvent(
      { accountId, userId },
      { event: 'issue_detected', sessionId: 'system', issueId: r.id, campaignId: r.campaignId, severity: r.severity, source: 'detector' },
      r.detectedAtIso
    );
  }
}
