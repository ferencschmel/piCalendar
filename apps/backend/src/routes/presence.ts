import { Router } from 'express';
import { presenceSightingInputSchema } from '@picalendar/shared';
import { config } from '../config/index.js';
import { getDb } from '../db/index.js';
import { getPresenceState, recordSighting } from '../db/repositories/presence.js';
import { requireAdmin } from '../middleware/auth.js';

export const presenceRouter: Router = Router();

/**
 * Placeholder surface for the camera work.
 *
 * The intended shape: a detector process on the Pi runs face recognition
 * locally, never uploading frames, and POSTs `{ personId, confidence }` here
 * whenever it recognises someone. `GET /api/agenda` then narrows itself to
 * whoever is currently present. Both halves exist already — only the detector
 * is missing.
 */
presenceRouter.get('/', (_req, res) => {
  res.json(getPresenceState(getDb(), config.presence.windowSeconds));
});

presenceRouter.post('/sightings', requireAdmin, (req, res) => {
  const input = presenceSightingInputSchema.parse(req.body);
  res.status(201).json({ sighting: recordSighting(getDb(), input) });
});
