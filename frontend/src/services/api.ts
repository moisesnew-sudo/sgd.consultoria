import { 
  Comment,
  Demand, 
  MunicipalityData, 
  SystemSettings, 
  User, 
  UserRole,
  PaginatedResponse, 
  DashboardStats,
  ExecutiveStats,
  TimelineEvent,
  PermissionCategory,
  UserPermission,
  Attachment,
  AuditLog,
  AuditDashboardStats,
  Session,
  Backup,
  BackupCreateResult,
  BackupVerifyResult,
  HealthCheck,
  MonitoringSnapshot,
  IntegrationInfo,
  LgpdDashboard,
  DemandVersion,
  IntegrationDashboard,
  IntegrationHealth,
  IntegrationLogsResponse,
  IntegrationSystemDetail,
  IntegrationAdapter,
  IntegrationSyncResult,
  IntegrationSystem,
  IntegrationSystemsResponse,
  IntegrationSystemCreateData,
  IntegrationSystemUpdateData,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.gruposgd.com.br';

let isRefreshing = false;
let refreshQueue: Array<{ resolve: () => void; reject: (error: any) => void }> = [];

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function buildHeaders(method?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    const csrf = getCsrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  return headers;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function refreshAccessToken(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() || '' },
  });
  if (!response.ok) throw new ApiError(401, 'Refresh token inválido');
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const method = options?.method || 'GET';

  const buildReqHeaders = (): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
      const csrf = getCsrfToken();
      if (csrf) h['X-CSRF-Token'] = csrf;
    }
    return h;
  };

  let response = await fetch(`${API_BASE}/api${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: { ...buildReqHeaders(), ...(options?.headers as Record<string, string> || {}) },
  });

  if (response.status === 401 && !endpoint.includes('/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        await refreshAccessToken();
        isRefreshing = false;
        refreshQueue.forEach(q => q.resolve());
        refreshQueue = [];

        response = await fetch(`${API_BASE}/api${endpoint}`, {
          ...options,
          credentials: 'include',
          headers: { ...buildReqHeaders(), ...(options?.headers as Record<string, string> || {}) },
        });
      } catch (err) {
        isRefreshing = false;
        refreshQueue.forEach(q => q.reject(err));
        refreshQueue = [];
        throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      });
      response = await fetch(`${API_BASE}/api${endpoint}`, {
        ...options,
        credentials: 'include',
        headers: { ...buildReqHeaders(), ...(options?.headers as Record<string, string> || {}) },
      });
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new ApiError(response.status, error.error || 'Erro na requisição');
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: async (email: string, password: string) => {
    const data = await request<{ user: User; session: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return data;
  },

  logout: async () => {
    try {
      await request<{ message: string }>('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
  },

  getMe: () => request<User>('/auth/me'),

  changePassword: async (currentPassword: string, newPassword: string) => {
    return request<{ message: string }>('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  listUsers: () => request<User[]>('/auth/users'),

  createUser: (data: { email: string; password: string; name: string; role: UserRole }) =>
    request<User>('/auth/users', { method: 'POST', body: JSON.stringify(data) }),

  updateUser: (id: number, data: { role?: UserRole; active?: boolean; name?: string; email?: string }) =>
    request<{ message: string; user: User }>('/auth/users/' + id, { method: 'PUT', body: JSON.stringify(data) }),

  deleteUser: (id: number) =>
    request<{ message: string }>('/auth/users/' + id, { method: 'DELETE' }),

  resetPasswordAsAdmin: (id: number, newPassword: string) =>
    request<{ message: string }>('/auth/users/' + id + '/password', {
      method: 'PUT',
      body: JSON.stringify({ newPassword }),
    }),
};

export const permissionsApi = {
  getAll: () => request<PermissionCategory[]>('/permissions'),

  getMyPermissions: () => request<string[]>('/permissions/my'),

  getUserPermissions: (userId: number) => request<UserPermission[]>(`/permissions/user/${userId}`),

  updateUserPermissions: (userId: number, permissions: { permission_id: number; granted: boolean }[]) =>
    request<{ message: string }>(`/permissions/user/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  analista: 'Analista',
  consulta: 'Consulta',
  administrador: 'Administrador',
  diretor: 'Diretor',
  tecnico: 'Técnico',
  parceiro: 'Parceiro',
  cliente: 'Cliente',
  visitante: 'Visitante',
};

export const ROLE_PERMISSIONS: Record<UserRole, {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canManageUsers: boolean;
  canViewUsers: boolean;
  canManageSettings: boolean;
}> = {
  admin:    { canCreate: true, canEdit: true, canDelete: true,  canManageUsers: true,  canViewUsers: true,  canManageSettings: true },
  gestor:   { canCreate: true, canEdit: true, canDelete: true,  canManageUsers: true,  canViewUsers: true,  canManageSettings: false },
  analista: { canCreate: true, canEdit: true, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
  consulta: { canCreate: false, canEdit: false, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
  administrador: { canCreate: true, canEdit: true, canDelete: true,  canManageUsers: true,  canViewUsers: true,  canManageSettings: true },
  diretor:   { canCreate: true, canEdit: true, canDelete: true,  canManageUsers: false, canViewUsers: true,  canManageSettings: false },
  tecnico:   { canCreate: true, canEdit: true, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
  parceiro:  { canCreate: false, canEdit: false, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
  cliente:   { canCreate: false, canEdit: false, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
  visitante: { canCreate: false, canEdit: false, canDelete: false, canManageUsers: false, canViewUsers: false, canManageSettings: false },
};

// Normalize a demand so numeric fields from PostgreSQL (returned as strings)
// are coerced to numbers, preventing "R$ NaN" in sums/formatting.
function normalizeDemand(d: any): Demand {
  return {
    ...d,
    requested_value: Number(d.requested_value) || 0,
    ano: d.ano != null ? Number(d.ano) : undefined,
  } as Demand;
}

// Demands API
async function uploadRequest<T>(endpoint: string, formData: FormData): Promise<T> {
  const buildUploadHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {};
    const csrf = getCsrfToken();
    if (csrf) h['X-CSRF-Token'] = csrf;
    return h;
  };

  let response = await fetch(`${API_BASE}/api${endpoint}`, {
    method: 'POST',
    credentials: 'include',
    headers: buildUploadHeaders(),
    body: formData,
  });

  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        await refreshAccessToken();
        isRefreshing = false;
        response = await fetch(`${API_BASE}/api${endpoint}`, {
          method: 'POST',
          credentials: 'include',
          headers: buildUploadHeaders(),
          body: formData,
        });
        refreshQueue.forEach(({ resolve }) => resolve());
        refreshQueue = [];
      } catch (error) {
        isRefreshing = false;
        refreshQueue.forEach(({ reject }) => reject(error));
        refreshQueue = [];
        window.location.href = '/login';
        throw error;
      }
    } else {
      await new Promise<void>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      });
      response = await fetch(`${API_BASE}/api${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: buildUploadHeaders(),
        body: formData,
      });
    }
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new ApiError(response.status, err.error || 'Erro na requisição');
  }

  return response.json();
}

export const demandsApi = {
  getAll: async (params?: {
    status?: string;
    priority?: string;
    municipality?: string;
    uf?: string;
    category?: string;
    search?: string;
    ano?: string;
    sortBy?: string;
    page?: number;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== 'all') {
          searchParams.append(key, String(value));
        }
      });
    }
    const res = await request<PaginatedResponse<Demand>>(`/demands?${searchParams.toString()}`);
    return { ...res, data: res.data.map(normalizeDemand) };
  },

  getById: async (id: string) => normalizeDemand(await request<Demand>(`/demands/${id}`)),

  create: (data: Partial<Demand>) => 
    request<Demand>('/demands', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: string, data: Partial<Demand>) =>
    request<Demand>(`/demands/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    request<{ message: string }>(`/demands/${id}`, {
      method: 'DELETE',
    }),

  addTimelineEvent: (demandId: string, event: { title: string; description?: string; status_changed_to?: string }) =>
    request<TimelineEvent>(`/demands/${demandId}/timeline`, {
      method: 'POST',
      body: JSON.stringify(event),
    }),

  getDashboardStats: () => request<DashboardStats>('/demands/stats/dashboard'),
  getExecutiveStats: (params?: { year?: string; uf?: string; status?: string; municipality?: string; dateFrom?: string; dateTo?: string }) => {
    const qs = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => { if (v) qs.append(k, v); });
    const q = qs.toString();
    return request<ExecutiveStats>(`/demands/stats/executive${q ? '?' + q : ''}`);
  },

  getCalendarEvents: () => request<Record<string, any>[]>('/demands/calendar/events'),

  listComments: (demandId: string) => request<Comment[]>(`/demands/${demandId}/comments`),

  addComment: (demandId: string, body: string) =>
    request<Comment>(`/demands/${demandId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  uploadAttachments: (demandId: string, files: File[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return uploadRequest<Attachment[]>(`/demands/${demandId}/attachments`, formData);
  },

  getAttachmentUrl: (id: number) => `${API_BASE}/api/attachments/${id}`,

  deleteAttachment: (id: number) =>
    request<{ message: string }>(`/attachments/${id}`, { method: 'DELETE' }),
};

// Export logging
export const logExport = async (exportType: 'pdf' | 'excel' | 'csv', recordCount: number, filters?: any, demandIds?: string[]) => {
  try {
    await request('/audit/log-export', {
      method: 'POST',
      body: JSON.stringify({ export_type: exportType, record_count: recordCount, filters, demand_ids: demandIds }),
    });
  } catch { /* non-critical */ }
};

// Audit API
export const auditApi = {
  list: async (params?: { entity_type?: string; entity_id?: string; action?: string; user_id?: string; start_date?: string; end_date?: string; search?: string; page?: number; limit?: number }): Promise<{ data: AuditLog[]; pagination?: { page: number; limit: number; total: number; pages: number } }> => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== 'all' && value !== '') searchParams.append(key, String(value));
      });
    }
    const qs = searchParams.toString();
    const res: any = await request(`/audit${qs ? '?' + qs : ''}`);
    if (Array.isArray(res)) return { data: res as AuditLog[], pagination: undefined };
    return { data: (res?.data || []) as AuditLog[], pagination: res?.pagination };
  },
  getDashboardStats: (params?: { start_date?: string; end_date?: string }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.append(key, String(value));
      });
    }
    const qs = searchParams.toString();
    return request<AuditDashboardStats>(`/audit/dashboard-stats${qs ? '?' + qs : ''}`);
  },
};

// Password Reset API
export const passwordResetApi = {
  request: (email: string) =>
    request<{ message: string }>('/password-reset/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  reset: (token: string, password: string) =>
    request<{ message: string }>('/password-reset/reset', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),
};

// Sessions API
export const sessionsApi = {
  list: () => request<Session[]>('/sessions'),
  terminate: (id: number) => request<{ message: string }>(`/sessions/${id}`, { method: 'DELETE' }),
  mySessions: () => request<Session[]>('/sessions/my-sessions'),
};

// Backups API
export const backupsApi = {
  list: () => request<Backup[]>('/backups'),
  create: (type: string = 'manual') =>
    request<BackupCreateResult>('/backups', { method: 'POST', body: JSON.stringify({ type }) }),
  download: (id: number) => `${API_BASE}/api/backups/${id}/download`,
  verify: (id: number) => request<BackupVerifyResult>(`/backups/${id}/verify`, { method: 'POST' }),
  restore: (id: number) => request<{ message: string }>(`/backups/${id}/restore`, { method: 'POST' }),
};

// Monitoring API
export const monitoringApi = {
  health: () => request<HealthCheck>('/monitoring/health'),
  snapshot: () => request<{ message: string }>('/monitoring/snapshot', { method: 'POST' }),
  history: (limit?: number) => request<MonitoringSnapshot[]>(`/monitoring/history${limit ? '?limit=' + limit : ''}`),
};

// LGPD API
export const lgpdApi = {
  dashboard: () => request<LgpdDashboard>('/lgpd/dashboard'),
};

// Demand Versions API
export const demandVersionsApi = {
  list: (demandId: string) => request<DemandVersion[]>(`/demands/${demandId}/versions`),
};

// Integration API
export const integrationsApi = {
  getInfo: () => request<IntegrationInfo>('/integrations'),
};

// Integration Admin API (Fase 3.1 — Fase C1/C4)
export const integrationAdminApi = {
  getDashboard: () => request<IntegrationDashboard>('/integrations/admin/dashboard'),

  getHealth: () => request<IntegrationHealth[]>('/integrations/admin/health'),

  getLogs: (params?: {
    page?: number;
    limit?: number;
    system?: number;
    systemCode?: string;
    status?: string;
    direction?: string;
    from?: string;
    to?: string;
    error?: boolean;
    search?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== null) qs.append(key, String(value));
      });
    }
    const q = qs.toString();
    return request<IntegrationLogsResponse>(`/integrations/admin/logs${q ? '?' + q : ''}`);
  },

  getSystemDetails: (id: number) => request<IntegrationSystemDetail>(`/integrations/admin/systems/${id}`),

  getAdapters: () => request<{ data: IntegrationAdapter[] }>('/integrations/admin/adapters'),

  syncSystem: (id: number, payload?: Record<string, unknown>) =>
    request<IntegrationSyncResult>(`/integrations/admin/systems/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify(payload ? { payload } : {}),
    }),

  // Sistemas de Integração (Fase C4)
  getSystems: (params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '' && value !== null) qs.append(key, String(value));
      });
    }
    const q = qs.toString();
    return request<IntegrationSystemsResponse>(`/integrations/systems${q ? '?' + q : ''}`);
  },

  getSystem: (id: number) => request<IntegrationSystem>(`/integrations/systems/${id}`),

  createSystem: (data: IntegrationSystemCreateData) =>
    request<IntegrationSystem>('/integrations/systems', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateSystem: (id: number, data: IntegrationSystemUpdateData) =>
    request<IntegrationSystem>(`/integrations/systems/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  setSystemActive: (id: number, active: boolean) =>
    request<IntegrationSystem>(`/integrations/systems/${id}/${active ? 'activate' : 'deactivate'}`, {
      method: 'PATCH',
    }),

};
// Municipalities API
export const municipalitiesApi = {
  getAll: async (params?: { uf?: string; region?: string; search?: string }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== 'all') {
          searchParams.append(key, value);
        }
      });
    }
    return request<MunicipalityData[]>(`/municipalities?${searchParams.toString()}`);
  },

  getById: (id: number) => request<MunicipalityData & { demands: Demand[] }>(`/municipalities/${id}`),

  create: (data: Partial<MunicipalityData>) =>
    request<MunicipalityData>('/municipalities', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: Partial<MunicipalityData>) =>
    request<MunicipalityData>(`/municipalities/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number) =>
    request<{ message: string }>(`/municipalities/${id}`, {
      method: 'DELETE',
    }),

  getStatsByRegion: () => request<{ region: string; count: number; total_value: number; avg_hdi: number }[]>('/municipalities/stats/by-region'),
};

// Standardization API (base oficial IBGE)
export const standardizationApi = {
  suggestMunicipalities: async (q: string, uf?: string) => {
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    if (uf) params.append('uf', uf);
    const res = await request<{ data: { nome: string; uf: string }[]; count: number }>(
      `/standardization/municipalities${params.toString() ? '?' + params.toString() : ''}`
    );
    return res.data.map(m => ({ value: m.nome, label: m.nome, secondary: m.uf }));
  },

  suggestObjects: async (q: string) => {
    const params = new URLSearchParams();
    if (q) params.append('q', q);
    const res = await request<{ data: string[]; count: number }>(
      `/standardization/objects${params.toString() ? '?' + params.toString() : ''}`
    );
    return res.data.map(t => ({ value: t }));
  },

  scan: () => request<unknown>('/standardization/scan', { method: 'POST' }),
  apply: () => request<unknown>('/standardization/apply', { method: 'POST' }),
};

// Órgãos (cadastro mestre)
export interface Org {
  id: number;
  name: string;
  active: boolean;
}

export const organsApi = {
  list: () => request<Org[]>('/organs'),

  create: (name: string) =>
    request<Org>('/organs', { method: 'POST', body: JSON.stringify({ name }) }),

  update: (id: number, name: string) =>
    request<Org>(`/organs/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),

  deactivate: (id: number) =>
    request<{ message: string }>(`/organs/${id}`, { method: 'DELETE' }),
};

// Usuários (seletor de responsável)
export const usersApi = {
  active: () => request<{ id: number; name: string; email: string }[]>('/users/active'),
};

// Settings API
export const settingsApi = {
  get: () => request<SystemSettings>('/settings'),

  update: (data: Partial<SystemSettings>) =>
    request<SystemSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  changePassword: (data: { current_password: string; new_password: string }) =>
    request<{ message: string }>('/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  export: () => request<Record<string, unknown>>('/settings/export'),

  importData: (data: Record<string, unknown>) =>
    request<{ message: string }>('/settings/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Helper functions
export const formatCurrency = (value: number): string => {
  const n = Number(value);
  if (!isFinite(n)) return 'R$ 0,00';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

export const formatDate = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return dateStr;
  }
};

export const formatDateShort = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return dateStr;
  }
};
