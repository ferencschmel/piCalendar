import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { HttpError } from './errors.js';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so compare lengths first — the
  // length of the configured token is not a secret worth protecting.
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Guards mutating admin routes with a shared bearer token.
 *
 * When `ADMIN_TOKEN` is unset the guard is a no-op: on a home LAN the device is
 * often the only thing on the network and requiring a token would be friction.
 * The setup doc calls out setting one before exposing the Pi beyond the LAN.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.adminToken;
  if (!expected) {
    next();
    return;
  }

  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.get('x-admin-token') ?? '');

  if (!token || !safeEqual(token, expected)) {
    next(HttpError.unauthorized());
    return;
  }
  next();
}
