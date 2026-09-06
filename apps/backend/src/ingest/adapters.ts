import type { FeedSourceType } from '@picalendar/shared';
import type { NormalizedEvent } from './types.js';

/**
 * Per-provider post-processing. Parsing is identical for every source — these
 * only clean up the presentation quirks each publisher bakes into its ICS.
 */
export type FeedAdapter = (event: NormalizedEvent) => NormalizedEvent | null;

/**
 * SportsEngine writes the opponent and venue into the summary and pads the
 * description with a boilerplate footer and the team's web link.
 */
const sportsEngine: FeedAdapter = (event) => {
  const summary = event.summary
    .replace(/\s*\(\s*(?:Home|Away)\s*\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const description = event.description
    ?.split(/\n{2,}/)
    .filter((block) => !/^\s*(?:powered by sportsengine|view (?:this )?event online)/i.test(block))
    .join('\n\n')
    .trim();

  return {
    ...event,
    summary: summary || event.summary,
    description: description && description.length > 0 ? description : null,
  };
};

/**
 * iCloud shared calendars mark declined invitations as CANCELLED but keep
 * publishing them; those should not take up space on a wall display.
 */
const icloud: FeedAdapter = (event) => (event.status?.toUpperCase() === 'CANCELLED' ? null : event);

const passthrough: FeedAdapter = (event) => event;

const adapters: Record<FeedSourceType, FeedAdapter> = {
  sportsengine: sportsEngine,
  icloud,
  ics: passthrough,
};

export function applyAdapter(
  sourceType: FeedSourceType,
  events: NormalizedEvent[],
): NormalizedEvent[] {
  const adapter = adapters[sourceType] ?? passthrough;
  const result: NormalizedEvent[] = [];
  for (const event of events) {
    const adapted = adapter(event);
    if (adapted) result.push(adapted);
  }
  return result;
}
