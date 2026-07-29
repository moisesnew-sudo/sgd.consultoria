import { 
  Comment,
  Demand, 
  MunicipalityData, 
  SystemSettings, 
  User, 
  UserRole,
  PaginatedResponse, 
  DashboardStats,
  TimelineEvent,
  PermissionCategory,
  UserPermission,
  Attachment
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://sgd-consultoria.onrender.com';

let isRefreshing = false;
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (error: any) => void }> = [];

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function refreshAccessToken(): Promise<string> {
  const refreshToken = localStorage.getItem('sgd_refresh_token');
  if (!refreshToken) throw new ApiError(401, 'Sem refresh token');

  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) throw new ApiError(401, 'Refresh token inválido');

  const data = await response.json();
  localStorage.setItem('sgd_token', data.token);
  if (data.refreshToken) {
    localStorage.setItem('sgd_refresh_token', data.refreshToken);
  }
  return data.token;
}

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('sgd_token');
  const headers = buildHeaders(token || undefined);

  let response = await fetch(`${API_BASE}/api${endpoint}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> || {}) },
  });

  if (response.status === 401 && !endpoint.includes('/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        isRefreshing = false;
        refreshQueue.forEach(q => q.resolve(newToken));
        refreshQueue = [];

        const retryHeaders = buildHeaders(newToken);
        response = await fetch(`${API_BASE}/api${endpoint}`, {
          ...options,
          headers: { ...retryHeaders, ...(options?.headers as Record<string, string> || {}) },
        });
      } catch (err) {
        isRefreshing = false;
        refreshQueue.forEach(q => q.reject(err));
        refreshQueue = [];
        localStorage.removeItem('sgd_token');
        localStorage.removeItem('sgd_refresh_token');
        localStorage.removeItem('sgd_user');
        throw new ApiError(401, 'Sessão expirada. Faça login novamente.');
      }
    } else {
      const newToken = await new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      });
      const queuedHeaders = buildHeaders(newToken);
      response = await fetch(`${API_BASE}/api${endpoint}`, {
        ...options,
        headers: { ...queuedHeaders, ...(options?.headers as Record<string, string> || {}) },
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
    const data = await request<{ token: string; refreshToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('sgd_token', data.token);
    if (data.refreshToken) localStorage.setItem('sgd_refresh_token', data.refreshToken);
    localStorage.setItem('sgd_user', JSON.stringify(data.user));
    return data;
  },

  logout: async () => {
    const refreshToken = localStorage.getItem('sgd_refresh_token');
    try {
      await request<{ message: string }>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch { /* ignore */ }
    localStorage.removeItem('sgd_token');
    localStorage.removeItem('sgd_refresh_token');
    localStorage.removeItem('sgd_user');
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

  updateUser: (id: number, data: { role?: UserRole; active?: boolean; name?: string }) =>
    request<User>('/auth/users/' + id, { method: 'PUT', body: JSON.stringify(data) }),
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
  gestor:   { canCreate: true, canEdit: true, canDelete: true,  canManageUsers: false, canViewUsers: true,  canManageSettings: false },
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
  const token = localStorage.getItem('sgd_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response = await fetch(`${API_BASE}/api${endpoint}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (response.status === 401) {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const newToken = await refreshAccessToken();
        isRefreshing = false;
        headers['Authorization'] = `Bearer ${newToken}`;
        response = await fetch(`${API_BASE}/api${endpoint}`, {
          method: 'POST',
          headers,
          body: formData,
        });
        refreshQueue.forEach(({ resolve }) => resolve(newToken));
        refreshQueue = [];
      } catch (error) {
        isRefreshing = false;
        refreshQueue.forEach(({ reject }) => reject(error));
        refreshQueue = [];
        localStorage.removeItem('sgd_token');
        localStorage.removeItem('sgd_refresh_token');
        window.location.href = '/login';
        throw error;
      }
    } else {
      const newToken = await new Promise<string>((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      });
      headers['Authorization'] = `Bearer ${newToken}`;
      response = await fetch(`${API_BASE}/api${endpoint}`, {
        method: 'POST',
        headers,
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
export const logExport = async (exportType: 'pdf' | 'excel', recordCount: number, filters?: any) => {
  try {
    await request('/audit/log-export', {
      method: 'POST',
      body: JSON.stringify({ export_type: exportType, record_count: recordCount, filters }),
    });
  } catch { /* non-critical */ }
};

// Audit API
export const auditApi = {
  list: async (params?: { entity_type?: string; entity_id?: string; action?: string; user_id?: string; start_date?: string; end_date?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== 'all' && value !== '') searchParams.append(key, String(value));
      });
    }
    const qs = searchParams.toString();
    const res = await request<any>(`/audit${qs ? '?' + qs : ''}`);
    return Array.isArray(res) ? res : (res.data || []);
  },
  getDashboardStats: (params?: { start_date?: string; end_date?: string }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) searchParams.append(key, String(value));
      });
    }
    const qs = searchParams.toString();
    return request<any>(`/audit/dashboard-stats${qs ? '?' + qs : ''}`);
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
  list: () => request<any[]>('/sessions'),
  terminate: (id: number) => request<{ message: string }>(`/sessions/${id}`, { method: 'DELETE' }),
  mySessions: () => request<any[]>('/sessions/my-sessions'),
};

// Backups API
export const backupsApi = {
  list: () => request<any[]>('/backups'),
  create: (type: string = 'manual') =>
    request<any>('/backups', { method: 'POST', body: JSON.stringify({ type }) }),
  download: (id: number) => `${API_BASE}/api/backups/${id}/download`,
  verify: (id: number) => request<{ valid: boolean; stored_hash: string; computed_hash: string; filename: string }>(`/backups/${id}/verify`, { method: 'POST' }),
  restore: (id: number) => request<{ message: string }>(`/backups/${id}/restore`, { method: 'POST' }),
};

// Monitoring API
export const monitoringApi = {
  health: () => request<any>('/monitoring/health'),
  snapshot: () => request<any>('/monitoring/snapshot', { method: 'POST' }),
  history: (limit?: number) => request<any[]>(`/monitoring/history${limit ? '?limit=' + limit : ''}`),
};

// LGPD API
export const lgpdApi = {
  dashboard: () => request<any>('/lgpd/dashboard'),
};

// Demand Versions API
export const demandVersionsApi = {
  list: (demandId: string) => request<any[]>(`/demands/${demandId}/versions`),
};

// Integration API
export const integrationsApi = {
  getInfo: () => request<any>('/integrations'),
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

  export: () => request<any>('/settings/export'),

  importData: (data: any) =>
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