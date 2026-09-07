import type {
  AgendaDensityResponse,
  AgendaResponse,
  ApiErrorBody,
  Birthday,
  BirthdayInputPayload,
  BirthdayUpdatePayload,
  Feed,
  FeedInput,
  FeedUpdate,
  HealthResponse,
  Person,
  PersonInput,
  PresenceState,
  SyncRun,
} from '@picalendar/shared';

/** Same-origin in production; the Vite dev server proxies /api in development. */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Set by the admin page when the backend has ADMIN_TOKEN configured. */
const TOKEN_KEY = 'picalendar.adminToken';

export function getAdminToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error.code ?? 'unknown',
      body?.error.message ?? `Request failed with ${response.status}`,
      body?.error.details,
    );
  }

  return payload as T;
}

/** The range and filters both agenda endpoints take. */
interface AgendaParams {
  start?: string;
  days?: number;
  personId?: string[];
}

function agendaQuery(params: AgendaParams): string {
  const search = new URLSearchParams();
  if (params.start) search.set('start', params.start);
  if (params.days) search.set('days', String(params.days));
  for (const id of params.personId ?? []) search.append('personId', id);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export const api = {
  agenda: (params: AgendaParams = {}) => request<AgendaResponse>(`/agenda${agendaQuery(params)}`),

  /** Colour marks only — what the month and year overviews poll. */
  agendaDensity: (params: AgendaParams = {}) =>
    request<AgendaDensityResponse>(`/agenda/density${agendaQuery(params)}`),

  health: () => request<HealthResponse>('/health'),

  listBirthdays: () => request<{ birthdays: Birthday[] }>('/birthdays').then((r) => r.birthdays),
  createBirthday: (input: BirthdayInputPayload) =>
    request<{ birthday: Birthday }>('/birthdays', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.birthday),
  updateBirthday: (id: string, patch: BirthdayUpdatePayload) =>
    request<{ birthday: Birthday }>(`/birthdays/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.birthday),
  deleteBirthday: (id: string) => request<void>(`/birthdays/${id}`, { method: 'DELETE' }),

  listFeeds: () => request<{ feeds: Feed[] }>('/feeds').then((r) => r.feeds),
  getFeed: (id: string) => request<{ feed: Feed; recentRuns: SyncRun[] }>(`/feeds/${id}`),
  createFeed: (input: FeedInput) =>
    request<{ feed: Feed }>('/feeds', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.feed,
    ),
  updateFeed: (id: string, patch: FeedUpdate) =>
    request<{ feed: Feed }>(`/feeds/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.feed,
    ),
  deleteFeed: (id: string) => request<void>(`/feeds/${id}`, { method: 'DELETE' }),
  syncFeed: (id: string) =>
    request<{ feed: Feed; outcome: { status: string; message: string | null } }>(
      `/feeds/${id}/sync`,
      { method: 'POST' },
    ),
  testFeed: (url: string, sourceType: string) =>
    request<{ ok: boolean; eventCount: number; occurrenceCount: number }>('/feeds/test', {
      method: 'POST',
      body: JSON.stringify({ url, sourceType }),
    }),

  listPeople: () => request<{ people: Person[] }>('/people').then((r) => r.people),
  createPerson: (input: PersonInput) =>
    request<{ person: Person }>('/people', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.person,
    ),
  deletePerson: (id: string) => request<void>(`/people/${id}`, { method: 'DELETE' }),

  presence: () => request<PresenceState>('/presence'),
};
