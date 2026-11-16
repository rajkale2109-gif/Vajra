import { Platform } from '../calculations/types.js';

export interface SyncResult {
  platform: Platform;
  status: 'connected' | 'delayed' | 'failed';
  lastSuccessfulSyncAt: string;
  updatedCampaignsCount: number;
  message: string;
  isSimulated: boolean;
}

export interface PauseResult {
  entityType: 'campaign' | 'ad_set';
  entityId: number | string;
  previousStatus: string;
  newStatus: string;
  isSimulated: boolean;
  executedAt: string;
  auditMessage: string;
}

export interface PlatformConnector {
  platform: Platform;
  isLive(): boolean;
  sync(accountId: string, options?: { forceFailure?: boolean; forceDelay?: boolean }): Promise<SyncResult>;
  pauseCampaign(campaignId: number, accountId: string): Promise<PauseResult>;
  pauseAdSet(adSetId: string, accountId: string): Promise<PauseResult>;
}
