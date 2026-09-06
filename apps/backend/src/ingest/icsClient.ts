import { createHash } from 'node:crypto';

export interface FetchOptions {
  etag?: string | null;
  lastModified?: string | null;
  timeoutMs: number;
}

export type FetchResult =
  | { status: 'not-modified' }
  | { status: 'ok'; body: string; etag: string | null; lastModified: string | null; hash: string };

/**
 * Apple's and SportsEngine's "subscribe" buttons hand out `webcal://` URLs,
 * which are just HTTPS with a scheme that tells the OS to open a calendar app.
 */
export function normalizeFeedUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^webcal:\/\//i.test(trimmed)) return `https://${trimmed.slice('webcal://'.length)}`;
  return trimmed;
}

export class IcsFetchError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'IcsFetchError';
  }
}

/**
 * Fetch an ICS document, using conditional requests so an unchanged calendar
 * costs a 304 and no parsing work. Some publishers ignore validators entirely,
 * so the body is also hashed — the caller can skip a re-parse on an identical
 * payload even when the server answered 200.
 */
export async function fetchIcs(url: string, options: FetchOptions): Promise<FetchResult> {
  const headers: Record<string, string> = {
    Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8',
    'User-Agent': 'piCalendar/0.1 (+https://github.com/)',
  };
  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(normalizeFeedUrl(url), {
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });

    if (response.status === 304) return { status: 'not-modified' };
    if (!response.ok) {
      throw new IcsFetchError(
        `Feed responded ${response.status} ${response.statusText}`,
        response.status,
      );
    }

    const body = await response.text();
    if (!body.includes('BEGIN:VCALENDAR')) {
      throw new IcsFetchError('Response is not an iCalendar document');
    }

    return {
      status: 'ok',
      body,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      hash: createHash('sha1').update(body).digest('hex'),
    };
  } catch (error) {
    if (error instanceof IcsFetchError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new IcsFetchError(`Feed timed out after ${options.timeoutMs}ms`);
    }
    throw new IcsFetchError(describeFetchFailure(error));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Node's `fetch` reports every transport problem as the bare string
 * "fetch failed" and hides the real reason in `cause`. Unwrapping it is what
 * turns an unactionable admin-page error into "getaddrinfo ENOTFOUND ..." or a
 * TLS complaint the operator can actually fix.
 */
function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown fetch failure';

  const causes: string[] = [];
  let cause: unknown = error.cause;
  for (let depth = 0; cause instanceof Error && depth < 3; depth += 1) {
    causes.push(cause.message);
    cause = cause.cause;
  }

  return causes.length > 0 ? `${error.message}: ${causes.join(': ')}` : error.message;
}
