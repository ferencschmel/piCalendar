import type {
  AgendaDensityResponse,
  AgendaResponse,
  ApiErrorBody,
  Birthday,
  BirthdayInputPayload,
  BirthdayUpdatePayload,
  Dish,
  DishInputPayload,
  DishUpdatePayload,
  CustomList,
  Feed,
  FeedInput,
  FeedUpdate,
  GroceryList,
  HealthResponse,
  IngredientSuggestion,
  ListInputPayload,
  ListItem,
  ListItemInputPayload,
  ListItemUpdatePayload,
  ListSummary,
  MenuEntryInputPayload,
  MenuEntryUpdatePayload,
  MenuResponse,
  Person,
  PersonInput,
  PlannedDish,
  PresenceState,
  SyncRun,
  Wish,
  WishInputPayload,
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

/** The window a grocery request shops for. */
interface GroceryParams {
  start?: string;
  days?: number;
}

function groceryQuery(params: GroceryParams): string {
  const search = new URLSearchParams();
  if (params.start) search.set('start', params.start);
  if (params.days) search.set('days', String(params.days));
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

  listDishes: () => request<{ dishes: Dish[] }>('/dishes').then((r) => r.dishes),
  getDish: (id: string) => request<{ dish: Dish }>(`/dishes/${id}`).then((r) => r.dish),
  /** Distinct ingredients across every dish, commonest first. */
  listIngredientSuggestions: () =>
    request<{ ingredients: IngredientSuggestion[] }>('/dishes/ingredients').then(
      (r) => r.ingredients,
    ),
  createDish: (input: DishInputPayload) =>
    request<{ dish: Dish }>('/dishes', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.dish,
    ),
  updateDish: (id: string, patch: DishUpdatePayload) =>
    request<{ dish: Dish }>(`/dishes/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(
      (r) => r.dish,
    ),
  /** Resolves with what the delete took with it, so the page can say so. */
  deleteDish: (id: string) =>
    request<{ removed: { timesCooked: number; wishCount: number } }>(`/dishes/${id}`, {
      method: 'DELETE',
    }).then((r) => r.removed),

  menu: (params: { start?: string; days?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.start) search.set('start', params.start);
    if (params.days) search.set('days', String(params.days));
    const query = search.toString();
    return request<MenuResponse>(`/menu${query ? `?${query}` : ''}`);
  },
  planDish: (input: MenuEntryInputPayload) =>
    request<{ entry: PlannedDish }>('/menu', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.entry,
    ),
  /** Moving between days or meals is a patch, so the entry keeps its identity. */
  moveEntry: (id: string, patch: MenuEntryUpdatePayload) =>
    request<{ entry: PlannedDish }>(`/menu/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.entry),
  unplanEntry: (id: string) => request<void>(`/menu/${id}`, { method: 'DELETE' }),

  listWishes: () => request<{ wishes: Wish[] }>('/menu/wishes').then((r) => r.wishes),
  createWish: (input: WishInputPayload) =>
    request<{ wish: Wish }>('/menu/wishes', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.wish,
    ),
  deleteWish: (id: string) => request<void>(`/menu/wishes/${id}`, { method: 'DELETE' }),

  listLists: () => request<{ lists: ListSummary[] }>('/lists').then((r) => r.lists),
  getList: (id: string) => request<{ list: CustomList }>(`/lists/${id}`).then((r) => r.list),
  createList: (input: ListInputPayload) =>
    request<{ list: CustomList }>('/lists', { method: 'POST', body: JSON.stringify(input) }).then(
      (r) => r.list,
    ),
  renameList: (id: string, name: string) =>
    request<{ list: CustomList }>(`/lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }).then((r) => r.list),
  deleteList: (id: string) => request<void>(`/lists/${id}`, { method: 'DELETE' }),

  addListItem: (listId: string, input: ListItemInputPayload) =>
    request<{ item: ListItem }>(`/lists/${listId}/items`, {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.item),
  /** Ticking and editing are the same call — a tick is a patch of one field. */
  updateListItem: (listId: string, itemId: string, patch: ListItemUpdatePayload) =>
    request<{ item: ListItem }>(`/lists/${listId}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.item),
  deleteListItem: (listId: string, itemId: string) =>
    request<void>(`/lists/${listId}/items/${itemId}`, { method: 'DELETE' }),
  clearCheckedItems: (listId: string) =>
    request<{ list: CustomList; removed: number }>(`/lists/${listId}/items/clear-checked`, {
      method: 'POST',
    }),

  grocery: (params: GroceryParams = {}) =>
    request<{ list: GroceryList }>(`/lists/grocery${groceryQuery(params)}`).then((r) => r.list),
  /**
   * Returns the whole refreshed list rather than the one line: a tick can
   * change nothing else, but the menu may have moved under the shopper, and
   * one round trip per tap is what a supermarket connection can afford.
   */
  tickGroceryItem: (params: GroceryParams, key: string, checked: boolean) =>
    request<{ list: GroceryList }>(`/lists/grocery/checks${groceryQuery(params)}`, {
      method: 'POST',
      body: JSON.stringify({ key, checked }),
    }).then((r) => r.list),
  clearGroceryChecks: (params: GroceryParams = {}) =>
    request<{ list: GroceryList }>(`/lists/grocery/checks${groceryQuery(params)}`, {
      method: 'DELETE',
    }).then((r) => r.list),

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
