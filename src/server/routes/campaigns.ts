import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { metricsService, CampaignWithComparison } from '../../services/metricsService.js';
import { config } from '../../config/index.js';

const campaignsQuerySchema = z.object({
  q: z.string().optional().default(''),
  plat: z.string().optional().default(''),
  obj: z.string().optional().default(''),
  st: z.string().optional().default(''),
  perf: z.string().optional().default(''),
  tab: z.enum(['all', 'att', 'imp', 'dec', 'Paused', 'Ended']).optional().default('all'),
  sort: z.string().optional().default('spend'),
  dir: z.coerce.number().optional().default(-1),
  page: z.coerce.number().optional().default(0),
  size: z.coerce.number().optional().default(10),
  current_start: z.string().optional().default('2026-11-08'),
  current_end: z.string().optional().default('2026-11-14'),
  previous_start: z.string().optional().default('2026-11-01'),
  previous_end: z.string().optional().default('2026-11-07'),
});

export const campaignsRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    '/campaigns',
    {
      schema: {
        description: 'Get list of campaigns with dynamic server-side comparisons, filters, sort, and pagination',
        tags: ['Campaigns'],
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            plat: { type: 'string' },
            obj: { type: 'string' },
            st: { type: 'string' },
            perf: { type: 'string' },
            tab: { type: 'string', enum: ['all', 'att', 'imp', 'dec', 'Paused', 'Ended'] },
            sort: { type: 'string', default: 'spend' },
            dir: { type: 'number', default: -1 },
            page: { type: 'number', default: 0 },
            size: { type: 'number', default: 10 },
            current_start: { type: 'string', default: '2026-11-08' },
            current_end: { type: 'string', default: '2026-11-14' },
            previous_start: { type: 'string', default: '2026-11-01' },
            previous_end: { type: 'string', default: '2026-11-07' },
          },
        },
      },
    },
    async (request, reply) => {
      const accountId = (request.headers['x-account-id'] as string) || config.DEFAULT_ACCOUNT_ID;
      const parsed = campaignsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', details: parsed.error.format() });
      }

      const {
        q,
        plat,
        obj,
        st,
        perf,
        tab,
        sort,
        dir,
        page,
        size,
        current_start,
        current_end,
        previous_start,
        previous_end,
      } = parsed.data;

      const all = await metricsService.getCampaignComparisons(accountId, {
        currentStart: current_start,
        currentEnd: current_end,
        previousStart: previous_start,
        previousEnd: previous_end,
      });

      // Helper functions matching prototype rules
      const isAtt = (c: CampaignWithComparison) =>
        c.status !== 'Ended' &&
        ((!c.reliability.isReliable && c.status !== 'Paused') ||
          (c.changes.ctr.relativePct != null && c.changes.ctr.relativePct <= config.DEFAULT_CTR_ISSUE_THRESHOLD) ||
          (c.changes.cpc.relativePct != null && c.changes.cpc.relativePct >= config.DEFAULT_CPC_ISSUE_THRESHOLD));

      const isImp = (c: CampaignWithComparison) =>
        c.reliability.isReliable &&
        c.changes.ctr.relativePct != null &&
        c.changes.ctr.relativePct > 5;

      const isDec = (c: CampaignWithComparison) =>
        c.reliability.isReliable &&
        c.changes.ctr.relativePct != null &&
        c.changes.ctr.relativePct < -5;

      // Tab counts over all campaigns
      const tabCounts = {
        all: all.length,
        att: all.filter(isAtt).length,
        imp: all.filter(isImp).length,
        dec: all.filter(isDec).length,
        Paused: all.filter((c) => c.status === 'Paused').length,
        Ended: all.filter((c) => c.status === 'Ended').length,
      };

      // Filter
      const searchLower = q.toLowerCase();
      let filtered = all.filter((c) => {
        if (searchLower && !c.name.toLowerCase().includes(searchLower) && !c.raw.toLowerCase().includes(searchLower)) {
          return false;
        }
        if (plat && c.platform !== plat) {
          return false;
        }
        if (obj && c.objective !== obj) {
          return false;
        }
        if (st && c.status !== st) {
          return false;
        }
        if (perf === 'imp' && !isImp(c)) {
          return false;
        }
        if (perf === 'dec' && !isDec(c)) {
          return false;
        }

        // Tab filter
        if (tab === 'att' && !isAtt(c)) return false;
        if (tab === 'imp' && !isImp(c)) return false;
        if (tab === 'dec' && !isDec(c)) return false;
        if (tab === 'Paused' && c.status !== 'Paused') return false;
        if (tab === 'Ended' && c.status !== 'Ended') return false;

        return true;
      });

      // Sort
      filtered.sort((a, b) => {
        if (sort === 'name') {
          return dir * a.name.localeCompare(b.name);
        }

        const getValue = (c: CampaignWithComparison): number | null => {
          switch (sort) {
            case 'spend':
              return c.current.spend;
            case 'pSpend':
              return c.previous.spend;
            case 'dS':
              return c.changes.spend.relativePct;
            case 'impr':
              return c.current.impressions;
            case 'clicks':
              return c.current.clicks;
            case 'ctr':
              return c.current.ctr;
            case 'pCtr':
              return c.previous.ctr;
            case 'dCtr':
              return c.changes.ctr.relativePct;
            case 'cpc':
              return c.current.cpc;
            case 'pCpc':
              return c.previous.cpc;
            case 'dCpc':
              return c.changes.cpc.relativePct;
            default:
              return c.current.spend;
          }
        };

        const valA = getValue(a);
        const valB = getValue(b);

        if (valA == null && valB == null) return 0;
        if (valA == null) return 1;
        if (valB == null) return -1;
        return dir * (valA - valB);
      });

      const totalMatching = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalMatching / size));
      const pageIndex = Math.min(Math.max(0, page), totalPages - 1);
      const items = filtered.slice(pageIndex * size, pageIndex * size + size);

      return reply.send({
        items,
        pagination: {
          total: totalMatching,
          page: pageIndex,
          size,
          totalPages,
        },
        tabCounts,
        dates: {
          currentStart: current_start,
          currentEnd: current_end,
          previousStart: previous_start,
          previousEnd: previous_end,
        },
      });
    }
  );
};
