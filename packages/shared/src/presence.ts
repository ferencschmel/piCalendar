import { z } from 'zod';

/**
 * Placeholder contract for the camera that will be mounted on the Pi. The
 * detector (running on-device) POSTs sightings; the dashboard reads the
 * currently-present set and narrows the agenda to those people.
 *
 * Nothing consumes this yet beyond the API surface — it exists so the schema
 * and routes do not have to be retrofitted later.
 */
export const presenceSourceTypes = ['camera', 'manual', 'schedule'] as const;
export type PresenceSource = (typeof presenceSourceTypes)[number];

export const presenceSightingInputSchema = z.object({
  personId: z.string().uuid(),
  /** Detector confidence 0..1; low-confidence sightings are stored but ignored. */
  confidence: z.number().min(0).max(1).default(1),
  source: z.enum(presenceSourceTypes).default('camera'),
  cameraId: z.string().trim().max(64).optional(),
  /** ISO timestamp; defaults to now. Allows batching delayed detections. */
  detectedAt: z.string().datetime().optional(),
});
export type PresenceSightingInput = z.infer<typeof presenceSightingInputSchema>;

export interface PresenceSighting {
  id: string;
  personId: string;
  detectedAt: string;
  confidence: number;
  source: PresenceSource;
  cameraId: string | null;
}

export interface PresenceState {
  /** People seen within the presence window, most recently seen first. */
  present: Array<{
    personId: string;
    displayName: string;
    color: string;
    lastSeenAt: string;
    confidence: number;
  }>;
  /** How long a sighting keeps someone "present", in seconds. */
  windowSeconds: number;
  evaluatedAt: string;
}
