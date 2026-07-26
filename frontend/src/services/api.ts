import { 
  Demand, 
  MunicipalityData, 
  SystemSettings, 
  User, 
  UserRole,
  PaginatedResponse, 
  DashboardStats,
  TimelineEvent,
  PermissionCategory,
  UserPermission
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://sgd-consultoria.onrender.com/api';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('sgd_token');
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
    throw new ApiError(response.status, error.error || 'Erro na requisição');
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: async (email: string, password: string) => {
    const data = await request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('sgd_token', data.token);
    localStorage.setItem('sgd_user', JSON.stringify(data.user));
    return data;
  },

  logout: async () => {
    try {
      await request<{ message: string }>('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    localStorage.removeItem('sgd_token');
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

  getCalendarEvents: () => request<any[]>('/demands/calendar/events'),

  listComments: (demandId: string) => request<any[]>(`/demands/${demandId}/comments`),

  addComment: (demandId: string, body: string) =>
    request<any>(`/demands/${demandId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
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
  list: (params?: { entity_type?: string; entity_id?: string; action?: string; user_id?: string; start_date?: string; end_date?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== 'all' && value !== '') searchParams.append(key, String(value));
      });
    }
    const qs = searchParams.toString();
    return request<any>(`/audit${qs ? '?' + qs : ''}`);
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
  download: (id: number) => `${API_BASE}/backups/${id}/download`,
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