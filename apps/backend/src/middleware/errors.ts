import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@picalendar/shared';
import { ZodError } from 'zod';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static notFound(what = 'Resource'): HttpError {
    return new HttpError(404, 'not_found', `${what} not found`);
  }

  static badRequest(message: string): HttpError {
    return new HttpError(400, 'bad_request', message);
  }

  static unauthorized(message = 'Missing or invalid admin token'): HttpError {
    return new HttpError(401, 'unauthorized', message);
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ApiErrorBody = {
    error: { code: 'not_found', message: 'No such endpoint' },
  };
  res.status(404).json(body);
}

/**
 * Express 5 forwards rejected promises from handlers here automatically, so
 * route code can be plain `async` without a wrapper.
 */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    const details: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      (details[key] ??= []).push(issue.message);
    }
    const body: ApiErrorBody = {
      error: { code: 'validation_failed', message: 'Request validation failed', details },
    };
    res.status(422).json(body);
    return;
  }

  if (error instanceof HttpError) {
    const body: ApiErrorBody = { error: { code: error.code, message: error.message } };
    res.status(error.statusCode).json(body);
    return;
  }

  // SQLite surfaces constraint violations as a coded error; a duplicate feed
  // URL is a user mistake, not a server fault.
  const code = (error as { code?: string }).code;
  if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT')) {
    const body: ApiErrorBody = {
      error: { code: 'conflict', message: 'That record conflicts with an existing one' },
    };
    res.status(409).json(body);
    return;
  }

  logger.error({ err: error }, 'unhandled request error');
  const body: ApiErrorBody = {
    error: { code: 'internal_error', message: 'Something went wrong' },
  };
  res.status(500).json(body);
}
