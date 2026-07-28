export const DEMAND_STATUSES = ['analise', 'pendente', 'concluido', 'rejeitado'] as const;
export const DEMAND_PRIORITIES = ['baixa', 'media', 'alta', 'urgente'] as const;
export const USER_ROLES = ['admin', 'gestor', 'analista', 'consulta', 'administrador', 'diretor', 'tecnico', 'parceiro', 'cliente', 'visitante'] as const;
export const REGIONS = ['Norte', 'Nordeste', 'Sudeste', 'Sul', 'Centro-Oeste'] as const;

export type DemandStatus = (typeof DEMAND_STATUSES)[number];
export type DemandPriority = (typeof DEMAND_PRIORITIES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type Region = (typeof REGIONS)[number];

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshToken {
  id: number;
  user_id: number;
  token_hash: string;
  family: string;
  expires_at: string;
  revoked: boolean;
  created_at: string;
  replaced_by?: string;
}

export interface User {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserResponse {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  permissions?: string[];
}

export interface MunicipalityData {
  id?: number;
  name: string;
  uf: string;
  demands_count: number;
  total_value: number;
  schools_count: number;
  population: number;
  hdi: number;
  region: Region;
}

export interface TimelineEvent {
  id: string;
  demand_id: string;
  title: string;
  description: string;
  user_name: string;
  status_changed_to?: DemandStatus;
  created_at: string;
}

export interface Attachment {
  id?: number;
  demand_id: string;
  name: string;
  size: string;
  type: string;
  file_path?: string;
}

export interface Demand {
  id: string;
  title: string;
  description: string;
  category: string;
  status: DemandStatus;
  priority: DemandPriority;
  municipality: string;
  uf: string;
  requested_value: number;
  prefeitura: string;
  proposal_number: string;
  organ: string;
  process_link?: string;
  responsible_name: string;
  responsible_email: string;
  responsible_phone: string;
  notes?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
  ano?: number;
  timeline?: TimelineEvent[];
  attachments?: Attachment[];
}

export interface SystemSettings {
  id?: number;
  sla_days_baixa: number;
  sla_days_media: number;
  sla_days_alta: number;
  sla_days_urgente: number;
  auto_triage: boolean;
  email_notifications: boolean;
  budget_cap: number;
}

export interface AuthRequest extends Express.Request {
  user?: UserResponse;
}

export interface Permission {
  id: number;
  key: string;
  name: string;
  category: string;
  description?: string;
  created_at: string;
}

export interface PermissionCategory {
  category: string;
  permissions: Permission[];
}