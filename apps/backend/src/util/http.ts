import type { Request } from 'express';
import { HttpError } from '../middleware/errors.js';

/**
 * Express 5 types route params as `string | string[] | undefined` because a
 * pattern can repeat a capture group. None of ours do, so this collapses the
 * union once instead of casting at every call site.
 */
export function pathParam(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  const single = Array.isArray(value) ? value[0] : value;
  if (typeof single !== 'string' || single.length === 0) {
    throw HttpError.badRequest(`Missing path parameter: ${name}`);
  }
  return single;
}
