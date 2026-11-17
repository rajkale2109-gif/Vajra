import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getTimeseries } from '../../services/timeseriesService.js';
import { config } from '../../config/index.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const querySchema = z.object({
  current_start: date.default('2026-11-08'),
  current_end: date.default('2026-11-14'),
  previous_start: date.default('2026-11-01'),
  previous_end: date.default('2026-11-07'),
  campaignId: z.coerce.number().int().optional(),
  campaignIds: z.string().optional(), // comma separated
  groupId: z.string().max(64).optional(),
  topN: z.coerce.number().int().min(1).max(20).optional(),
});

export const timeseriesRoutes: FastifyPluginAsync = async (server) => {
  server.get(
    '/timeseries',
    {
      schema: {
        description:
          'Daily time series (current vs previous period, aligned by day) for charts. Scope by campaignId, campaignIds, or groupId; defaults to the whole account. Missing data is null, never 0.',
        tags: ['Overview'],
      },
    },
    async (request, reply) => {
      const accountId = (request.headers['x-account-id'] as string) || config.DEFAULT_ACCOUNT_ID;
      const parsed = querySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', details: parsed.error.format() });
      }
      const q = parsed.data;
      if (q.current_end < q.current_start || q.previous_end < q.previous_start) {
        return reply.status(400).send({ error: 'Period end must not be before its start' });
      }
      const campaignIds = q.campaignIds
        ? q.campaignIds.split(',').map(Number).filter((n) => Number.isInteger(n))
        : undefined;

      return reply.send(
        await getTimeseries(
          accountId,
          { currentStart: q.current_start, currentEnd: q.current_end, previousStart: q.previous_start, previousEnd: q.previous_end },
          { campaignId: q.campaignId, campaignIds, groupId: q.groupId, topN: q.topN }
        )
      );
    }
  );
};
