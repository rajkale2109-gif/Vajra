import { and, desc, eq, inArray, gte, isNotNull, lte } from 'drizzle-orm';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { config } from '../config/index.js';
import { aggregateCampaigns, CampaignWithMetrics } from '../calculations/aggregations.js';
import { calculateChange, calculateCtrChange, computeMetrics } from '../calculations/metrics.js';
import { classifyReliability } from '../calculations/reliability.js';
import { ComputedMetrics, RawMetrics } from '../calculations/types.js';
import { nowDisplay } from './clock.js';
import { CampaignWithComparison, DateRangeParams, metricsService } from './metricsService.js';

export const NO_AD_SETS_MESSAGE = 'No ad sets configured yet — metrics unavailable.';

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

const EMPTY_RAW: RawMetrics = { spend: null, impressions: null, clicks: null, reach: null, engagements: null, conversions: null, revenue: null };

export function toAggItems(comparisons: CampaignWithComparison[]): CampaignWithMetrics[] {
  return comparisons.map((c) => ({
    campaign: {
      id: c.campaignId,
      name: c.name,
      status: c.status,
      syncStatus:
        c.reliability.reasonCode === 'f' ? 'failed' : c.reliability.reasonCode === 'n' ? 'noadsets' : c.reliability.reasonCode === 'd' ? 'delayed' : 'ok',
      lastSync: c.lastSync,
    },
    current: c.current,
    previous: c.previous,
  }));
}

export function aggOptions(dates: DateRangeParams) {
  return {
    minImpressionsThreshold: config.DEFAULT_MIN_IMPRESSIONS,
    todayDate: config.SIMULATED_CURRENT_DATE,
    currentPeriodEnd: dates.currentEnd,
  };
}

// ---------------------------------------------------------------------------
// Activity log
// ---------------------------------------------------------------------------

export async function logActivity(
  accountId: string,
  type: 'Campaign' | 'Group' | 'Alert' | 'Selection' | 'System',
  actionText: string,
  relatedEntity = '—',
  userId: string = config.DEFAULT_USER_ID
): Promise<void> {
  const { db } = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  await db.insert(schema.activityLog).values({
    accountId,
    userId: user ? userId : null,
    userName: user?.name ?? 'Planner',
    timestampText: nowDisplay(),
    type,
    actionText,
    relatedEntity,
  });
}

export async function listActivity(accountId: string, type?: string) {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.accountId, accountId))
    .orderBy(desc(schema.activityLog.id));
  return rows.filter((r) => !type || r.type === type);
}

// ---------------------------------------------------------------------------
// Drilldown: campaign -> ad sets
// ---------------------------------------------------------------------------

function sumRows(rows: Array<typeof schema.dailyMetrics.$inferSelect>): RawMetrics | null {
  if (!rows.length) return null;
  const add = (a: number | null, b: number | string | null) => (b == null ? a : (a ?? 0) + Number(b));
  return rows.reduce<RawMetrics>(
    (acc, r) => ({
      spend: add(acc.spend, r.spend),
      impressions: add(acc.impressions, r.impressions),
      clicks: add(acc.clicks, r.clicks),
      reach: add(acc.reach ?? null, r.reach),
      engagements: add(acc.engagements ?? null, r.engagements),
      conversions: add(acc.conversions ?? null, r.conversions),
      revenue: add(acc.revenue ?? null, r.revenue),
    }),
    { ...EMPTY_RAW }
  );
}

export async function getCampaignDetail(accountId: string, campaignId: number, dates: DateRangeParams) {
  const { db } = await getDb();
  const all = await metricsService.getCampaignComparisons(accountId, dates);
  const campaign = all.find((c) => c.campaignId === campaignId);
  if (!campaign) throw new HttpError(404, 'Campaign not found');

  const adSetRows = await db.select().from(schema.adSets).where(eq(schema.adSets.campaignId, campaignId));
  const rows = adSetRows.length
    ? await db
        .select()
        .from(schema.dailyMetrics)
        .where(
          and(
            eq(schema.dailyMetrics.accountId, accountId),
            eq(schema.dailyMetrics.campaignId, campaignId),
            isNotNull(schema.dailyMetrics.adSetId),
            gte(schema.dailyMetrics.date, dates.previousStart),
            lte(schema.dailyMetrics.date, dates.currentEnd)
          )
        )
    : [];

  const failed = campaign.reliability.reasonCode === 'f';
  const adSets = adSetRows.map((a) => {
    const mine = rows.filter((r) => r.adSetId === a.id);
    const curRaw = failed ? null : sumRows(mine.filter((r) => r.date >= dates.currentStart && r.date <= dates.currentEnd));
    const prevRaw = failed ? null : sumRows(mine.filter((r) => r.date >= dates.previousStart && r.date <= dates.previousEnd));
    const cur: ComputedMetrics = computeMetrics(curRaw ?? EMPTY_RAW);
    const prev: ComputedMetrics = computeMetrics(prevRaw ?? EMPTY_RAW);
    const reliability = classifyReliability(
      {
        id: a.id,
        name: a.name,
        status: a.status,
        syncStatus: failed ? 'failed' : campaign.reliability.reasonCode === 'd' ? 'delayed' : 'ok',
        lastSync: campaign.lastSync,
        adSetCount: adSetRows.length,
      },
      curRaw,
      prevRaw,
      aggOptions(dates)
    );
    return {
      id: a.id,
      name: a.name,
      audience: a.audience,
      status: a.status,
      current: cur,
      previous: prev,
      changes: {
        spend: calculateChange(cur.spend, prev.spend),
        impressions: calculateChange(cur.impressions, prev.impressions),
        clicks: calculateChange(cur.clicks, prev.clicks),
        ctr: calculateCtrChange(cur.ctr, prev.ctr),
        cpc: calculateChange(cur.cpc, prev.cpc),
      },
      reliability,
    };
  });

  return {
    campaign,
    adSets,
    adSetCount: adSets.length,
    message: adSets.length === 0 ? NO_AD_SETS_MESSAGE : null,
    drilldownDepth: 'ad_set', // deeper analysis stays in the ad platforms
  };
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export interface GroupMemberView {
  campaignId: number;
  name: string;
  platform: string;
  objective: string;
  status: string;
  reliability: CampaignWithComparison['reliability'];
  current: ComputedMetrics;
  previous: ComputedMetrics;
  ended: boolean;
  inTotals: boolean;
  inLikeForLike: boolean;
  note: string;
}

export async function listGroups(accountId: string, dates: DateRangeParams) {
  const { db } = await getDb();
  const groupRows = await db.select().from(schema.groups).where(eq(schema.groups.accountId, accountId));
  const members = groupRows.length
    ? await db
        .select()
        .from(schema.groupMembers)
        .where(
          inArray(
            schema.groupMembers.groupId,
            groupRows.map((g) => g.id)
          )
        )
    : [];
  const comparisons = await metricsService.getCampaignComparisons(accountId, dates);
  const byId = new Map(comparisons.map((c) => [c.campaignId, c]));

  return groupRows.map((g) => {
    const mine = members.filter((m) => m.groupId === g.id);
    const camps = mine.map((m) => byId.get(m.campaignId)).filter((c): c is CampaignWithComparison => !!c);
    const agg = camps.length ? aggregateCampaigns(toAggItems(camps), aggOptions(dates)) : null;
    const excluded = new Map((agg?.likeForLike.excludedCampaigns ?? []).map((x) => [x.campaignId, x]));

    const memberViews: GroupMemberView[] = camps.map((c) => {
      const code = c.reliability.reasonCode;
      const inTotals = code !== 'f' && code !== 'n';
      const inLfl = !excluded.has(c.campaignId);
      const ended = c.status === 'Ended';
      let note = '';
      if (ended) {
        note = inTotals
          ? 'Ended — included in combined totals (historical data in this period).'
          : 'Ended — not included in combined totals (no usable data).';
      } else if (!inTotals) {
        note = code === 'f' ? 'Sync failed — excluded, never counted as zero.' : 'No ad sets configured yet — metrics unavailable; excluded.';
      } else if (!inLfl) {
        note = `In combined totals; excluded from % change (${excluded.get(c.campaignId)?.reasonText ?? 'not comparable'}).`;
      }
      return {
        campaignId: c.campaignId,
        name: c.name,
        platform: c.platform,
        objective: c.objective,
        status: c.status,
        reliability: c.reliability,
        current: c.current,
        previous: c.previous,
        ended,
        inTotals,
        inLikeForLike: inTotals && inLfl,
        note,
      };
    });

    return {
      id: g.id,
      name: g.name,
      description: g.description,
      updatedText: g.updatedText,
      campaignCount: mine.length,
      members: memberViews,
      combined: agg
        ? {
            current: agg.current,
            previous: agg.previous,
            // % change is only meaningful like-for-like (reliable in both periods)
            likeForLike: agg.likeForLike,
            hasDelayedData: agg.hasDelayedData,
            isProvisional: agg.isProvisional,
          }
        : null,
    };
  });
}

export async function createGroup(accountId: string, name: string, description: string, campaignIds: number[]) {
  const { db } = await getDb();
  const clean = name.trim();
  if (!clean) throw new HttpError(400, 'Group name is required');
  const existing = await db.select().from(schema.groups).where(eq(schema.groups.accountId, accountId));
  if (existing.some((g) => g.name.toLowerCase() === clean.toLowerCase())) {
    throw new HttpError(409, `A group named "${clean}" already exists`);
  }
  const id = `g${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
  await db.insert(schema.groups).values({
    id,
    accountId,
    name: clean,
    description: description.trim(),
    updatedText: nowDisplay().split(',')[0],
  });
  const result = campaignIds.length ? await addToGroup(accountId, id, campaignIds, true) : { added: [], skipped: [] };
  await logActivity(accountId, 'Group', `Group "${clean}" created`, clean);
  return { id, name: clean, ...result };
}

export async function addToGroup(accountId: string, groupId: string, campaignIds: number[], quiet = false) {
  const { db } = await getDb();
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.accountId, accountId)));
  if (!group) throw new HttpError(404, 'Group not found');

  const valid = await db
    .select({ id: schema.campaigns.id, name: schema.campaigns.displayName })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.accountId, accountId), inArray(schema.campaigns.id, campaignIds.length ? campaignIds : [-1])));
  const validIds = new Set(valid.map((v) => v.id));
  const current = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
  const inGroup = new Set(current.map((m) => m.campaignId));

  const added: number[] = [];
  const skipped: Array<{ campaignId: number; reason: 'duplicate' | 'not_found' }> = [];
  for (const cid of [...new Set(campaignIds)]) {
    if (!validIds.has(cid)) skipped.push({ campaignId: cid, reason: 'not_found' });
    // A campaign appears only once per group so combined totals are never double-counted.
    else if (inGroup.has(cid)) skipped.push({ campaignId: cid, reason: 'duplicate' });
    else added.push(cid);
  }
  // Repeated ids inside the request are duplicates too
  const seen = new Set<number>();
  for (const cid of campaignIds) {
    if (seen.has(cid) && !skipped.some((s) => s.campaignId === cid)) skipped.push({ campaignId: cid, reason: 'duplicate' });
    seen.add(cid);
  }

  if (added.length) {
    await db.insert(schema.groupMembers).values(added.map((campaignId) => ({ groupId, campaignId })));
    await db
      .update(schema.groups)
      .set({ updatedText: nowDisplay().split(',')[0], updatedAt: new Date() })
      .where(eq(schema.groups.id, groupId));
    if (!quiet) {
      const names = valid.filter((v) => added.includes(v.id)).map((v) => v.name);
      await logActivity(
        accountId,
        'Group',
        names.length === 1 ? `Campaign "${names[0]}" added to group` : `${names.length} campaigns added to group`,
        group.name
      );
    }
  }
  return { added, skipped };
}

export async function removeFromGroup(accountId: string, groupId: string, campaignId: number) {
  const { db } = await getDb();
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.accountId, accountId)));
  if (!group) throw new HttpError(404, 'Group not found');
  await db.delete(schema.groupMembers).where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.campaignId, campaignId)));
  await logActivity(accountId, 'Group', `Campaign ${campaignId} removed from group`, group.name);
}

export async function deleteGroup(accountId: string, groupId: string) {
  const { db } = await getDb();
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.id, groupId), eq(schema.groups.accountId, accountId)));
  if (!group) throw new HttpError(404, 'Group not found');
  // Rules watching this group would silently stop evaluating, so block until the planner resolves them.
  const rules = await db.select().from(schema.alertRules).where(eq(schema.alertRules.accountId, accountId));
  const watching = rules.filter((r) => r.entityType === 'group' && (JSON.parse(r.entityIds) as string[]).includes(groupId));
  if (watching.length) {
    throw new HttpError(409, `Group is watched by ${watching.length} alert rule(s): ${watching.map((r) => r.name).join(', ')}. Delete or change those rules first.`);
  }
  await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
  await logActivity(accountId, 'Group', `Group "${group.name}" deleted`, group.name);
}

// ---------------------------------------------------------------------------
// Bulk actions (planner-initiated, scoped, confirmed)
// ---------------------------------------------------------------------------

export interface BulkScope {
  campaigns: number;
  adSets: number;
  /** Total campaigns considered (M in "N of M selected") */
  ofCampaigns: number;
  summary: string;
}

export async function bulkStatus(
  accountId: string,
  input: { action: 'pause' | 'resume'; campaignIds: number[]; adSetIds: string[]; confirm: boolean; totalCampaigns?: number }
) {
  const { db } = await getDb();
  const campaignIds = [...new Set(input.campaignIds)];
  const adSetIds = [...new Set(input.adSetIds)];
  if (!campaignIds.length && !adSetIds.length) throw new HttpError(400, 'Nothing selected');

  const allCampaigns = await db.select().from(schema.campaigns).where(eq(schema.campaigns.accountId, accountId));
  const allById = new Map(allCampaigns.map((c) => [c.id, c]));
  const adSetRows = adSetIds.length ? await db.select().from(schema.adSets).where(inArray(schema.adSets.id, adSetIds)) : [];
  const adSetOwners = adSetRows.filter((a) => allById.has(a.campaignId));

  const verb = input.action === 'pause' ? 'Pause' : 'Resume';
  const scope: BulkScope = {
    campaigns: campaignIds.length,
    adSets: adSetOwners.length,
    ofCampaigns: input.totalCampaigns ?? allCampaigns.length,
    summary: `${verb} ${campaignIds.length} of ${input.totalCampaigns ?? allCampaigns.length} campaign(s)${
      adSetOwners.length ? ` and ${adSetOwners.length} selected ad set(s) only (not their whole campaigns)` : ''
    }`,
  };

  // High-impact actions must be explicitly confirmed with the scope shown.
  if (!input.confirm) {
    throw new HttpError(409, 'Confirmation required before this action runs', { code: 'confirmation_required', scope });
  }

  const applied: Array<{ type: 'campaign' | 'adset'; id: number | string; from: string; to: string }> = [];
  const skipped: Array<{ type: 'campaign' | 'adset'; id: number | string; reason: string }> = [];
  const targetFor = (status: string, initial: string) => {
    if (input.action === 'pause') return status === 'Paused' ? null : 'Paused';
    if (status !== 'Paused') return null;
    return initial === 'Paused' || initial === 'Ended' ? 'Active' : initial;
  };

  for (const cid of campaignIds) {
    const c = allById.get(cid);
    if (!c) {
      skipped.push({ type: 'campaign', id: cid, reason: 'not found' });
      continue;
    }
    if (c.status === 'Ended') {
      skipped.push({ type: 'campaign', id: cid, reason: 'Ended campaigns cannot be changed' });
      continue;
    }
    const to = targetFor(c.status, c.initialStatus);
    if (!to) {
      skipped.push({ type: 'campaign', id: cid, reason: `already ${c.status === 'Paused' ? 'paused' : 'not paused'}` });
      continue;
    }
    await db.update(schema.campaigns).set({ status: to, updatedAt: new Date() }).where(eq(schema.campaigns.id, cid));
    applied.push({ type: 'campaign', id: cid, from: c.status, to });
  }

  for (const a of adSetOwners) {
    if (a.status === 'Ended') {
      skipped.push({ type: 'adset', id: a.id, reason: 'Ended ad sets cannot be changed' });
      continue;
    }
    const to = targetFor(a.status, a.initialStatus);
    if (!to) {
      skipped.push({ type: 'adset', id: a.id, reason: `already ${a.status === 'Paused' ? 'paused' : 'not paused'}` });
      continue;
    }
    await db.update(schema.adSets).set({ status: to, updatedAt: new Date() }).where(eq(schema.adSets.id, a.id));
    applied.push({ type: 'adset', id: a.id, from: a.status, to });
  }
  for (const id of adSetIds) {
    if (!adSetOwners.some((a) => a.id === id)) skipped.push({ type: 'adset', id, reason: 'not found' });
  }

  await logActivity(
    accountId,
    'Selection',
    `${verb} applied to ${applied.filter((x) => x.type === 'campaign').length} campaign(s)${
      applied.some((x) => x.type === 'adset') ? ` and ${applied.filter((x) => x.type === 'adset').length} ad set(s)` : ''
    }`,
    `${scope.summary}`
  );

  return { scope, applied, skipped };
}
