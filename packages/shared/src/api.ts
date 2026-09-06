/** Envelope returned by every error path so the client can render uniformly. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level messages keyed by dotted path, for form validation. */
    details?: Record<string, string[]>;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  database: { ok: boolean; path: string };
  feeds: { total: number; enabled: number; failing: number };
  time: string;
}

export const API_PREFIX = '/api';
