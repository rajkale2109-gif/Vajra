import { Platform } from '../calculations/types.js';
import { PlatformConnector, SyncResult, PauseResult } from './interface.js';
import { config } from '../config/index.js';
import { getDb } from '../db/connection.js';
import * as schema from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export class SimulatedPlatformConnector implements PlatformConnector {
  constructor(public readonly platform: Platform) {}

  isLive(): boolean {
    return false;
  }

  async sync(
    accountId: string,
    options: { forceFailure?: boolean; forceDelay?: boolean } = {}
  ): Promise<SyncResult> {
    const { db } = await getDb();
    const nowStr = new Date().toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const shouldFail = options.forceFailure;
    const shouldDelay =
      options.forceDelay ??
      (this.platform === 'Google' && config.SIMULATE_GOOGLE_DELAY);

    const status = shouldFail ? 'failed' : shouldDelay ? 'delayed' : 'connected';
    const message = shouldFail
      ? `${this.platform} sync failed (simulated).`
      : shouldDelay
      ? `${this.platform} sync delayed (simulated retry pending).`
      : `${this.platform} synced successfully (simulated).`;

    // Update platform connection in database
    await db
      .update(schema.platformConnections)
      .set({
        status,
        lastSuccessfulSyncAt: status === 'connected' ? nowStr : undefined,
        syncMessage: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.platformConnections.accountId, accountId),
          eq(schema.platformConnections.platform, this.platform)
        )
      );

    return {
      platform: this.platform,
      status,
      lastSuccessfulSyncAt: nowStr,
      updatedCampaignsCount: this.platform === 'Meta' ? 14 : 14,
      message,
      isSimulated: true,
    };
  }

  async pauseCampaign(campaignId: number, accountId: string): Promise<PauseResult> {
    const { db } = await getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.id, campaignId),
          eq(schema.campaigns.accountId, accountId)
        )
      );

    const prevStatus = campaign?.status || 'Active';

    // Audited update
    await db
      .update(schema.campaigns)
      .set({
        status: 'Paused',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.campaigns.id, campaignId),
          eq(schema.campaigns.accountId, accountId)
        )
      );

    const nowStr = new Date().toISOString();

    return {
      entityType: 'campaign',
      entityId: campaignId,
      previousStatus: prevStatus,
      newStatus: 'Paused',
      isSimulated: true,
      executedAt: nowStr,
      auditMessage: `Campaign ${campaignId} paused (simulated — no live call to ${this.platform} Ads)`,
    };
  }

  async pauseAdSet(adSetId: string, accountId: string): Promise<PauseResult> {
    const { db } = await getDb();
    const [adSet] = await db
      .select()
      .from(schema.adSets)
      .where(eq(schema.adSets.id, adSetId));

    const prevStatus = adSet?.status || 'Active';

    // Audited update
    await db
      .update(schema.adSets)
      .set({
        status: 'Paused',
        updatedAt: new Date(),
      })
      .where(eq(schema.adSets.id, adSetId));

    const nowStr = new Date().toISOString();

    return {
      entityType: 'ad_set',
      entityId: adSetId,
      previousStatus: prevStatus,
      newStatus: 'Paused',
      isSimulated: true,
      executedAt: nowStr,
      auditMessage: `Ad set ${adSetId} paused (simulated — no live call to ${this.platform} Ads)`,
    };
  }
}

export class LivePlatformConnectorStub implements PlatformConnector {
  constructor(
    public readonly platform: Platform,
    private readonly credentials: Record<string, string>
  ) {}

  isLive(): boolean {
    return true;
  }

  async sync(accountId: string): Promise<SyncResult> {
    throw new Error(
      `Live connector for ${this.platform} requires live API credentials which are not configured. Use simulated connector.`
    );
  }

  async pauseCampaign(campaignId: number, accountId: string): Promise<PauseResult> {
    throw new Error(
      `Live connector for ${this.platform} requires live API credentials to execute real pause on ${this.platform} API.`
    );
  }

  async pauseAdSet(adSetId: string, accountId: string): Promise<PauseResult> {
    throw new Error(
      `Live connector for ${this.platform} requires live API credentials to execute real pause on ${this.platform} API.`
    );
  }
}

export function getConnector(platform: Platform, credentials?: Record<string, string>): PlatformConnector {
  if (credentials && credentials.accessToken) {
    return new LivePlatformConnectorStub(platform, credentials);
  }
  return new SimulatedPlatformConnector(platform);
}
