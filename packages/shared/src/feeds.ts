import { z } from 'zod';

/**
 * Every supported provider ultimately publishes iCalendar (RFC 5545) over HTTP.
 * The source type only changes how we *normalise* the payload — quirks per
 * provider are handled by an adapter, not by a separate ingestion pipeline.
 */
export const feedSourceTypes = ['sportsengine', 'icloud', 'ics'] as const;
export type FeedSourceType = (typeof feedSourceTypes)[number];

export const feedSyncStatuses = ['pending', 'ok', 'error'] as const;
export type FeedSyncStatus = (typeof feedSyncStatuses)[number];

/** Hex colour used to tint the feed's events on the dashboard. */
const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex colour, e.g. #0d6efd');

/**
 * Accepts `webcal://` because that is what Apple and SportsEngine hand out from
 * their "subscribe" buttons; it is normalised to `https://` before fetching.
 */
export const feedUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .refine(
    (value) => /^(https?|webcal):\/\//i.test(value),
    'URL must start with https://, http:// or webcal://',
  );

export const feedInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  sourceType: z.enum(feedSourceTypes),
  url: feedUrlSchema,
  enabled: z.boolean().default(true),
  color: colorSchema.default('#0d6efd'),
  refreshIntervalSeconds: z.number().int().min(60).max(86_400).default(900),
  /** People whose presence should surface this feed once the camera exists. */
  personIds: z.array(z.string().uuid()).default([]),
});
export type FeedInput = z.infer<typeof feedInputSchema>;

export const feedUpdateSchema = feedInputSchema.partial();
export type FeedUpdate = z.infer<typeof feedUpdateSchema>;

export interface Feed {
  id: string;
  name: string;
  sourceType: FeedSourceType;
  url: string;
  enabled: boolean;
  color: string;
  refreshIntervalSeconds: number;
  personIds: string[];
  lastStatus: FeedSyncStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  eventCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRun {
  id: string;
  feedId: string;
  startedAt: string;
  finishedAt: string | null;
  status: FeedSyncStatus;
  eventsUpserted: number;
  eventsDeleted: number;
  message: string | null;
}
