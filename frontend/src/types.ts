export type DemandStatus = 'analise' | 'pendente' | 'concluido' | 'rejeitado';
export type DemandPriority = 'baixa' | 'media' | 'alta' | 'urgente';
export type UserRole = 'admin' | 'gestor' | 'analista' | 'consulta' | 'administrador' | 'diretor' | 'tecnico' | 'parceiro' | 'cliente' | 'visitante';
export type Region = 'Norte' | 'Nordeste' | 'Sudeste' | 'Sul' | 'Centro-Oeste';

export interface User {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  active?: boolean;
  created_at?: string;
  permissions?: string[];
}

export interface Permission {
  id: number;
  key: string;
  name: string;
  category: string;
  description?: string;
}

export interface PermissionCategory {
  category: string;
  permissions: Permission[];
}

export interface UserPermission {
  permission_id: number;
  key: string;
  granted: boolean;
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

export type TimelineEventType =
  | 'created' | 'updated' | 'status_changed' | 'concluded' | 'comment'
  | 'attachment' | 'export' | 'deleted' | 'restored' | 'note';

export interface TimelineEvent {
  id: string;
  demand_id: string;
  title: string;
  description: string;
  user_name: string;
  status_changed_to?: DemandStatus;
  event_type?: TimelineEventType;
  details?: Record<string, any> | null;
  created_at: string;
}

export interface Attachment {
  id?: number;
  demand_id: string;
  name: string;
  size?: string;
  type?: string;
  file_size?: number;
  mime_type?: string;
  file_hash?: string;
  file_path?: string;
  uploaded_by?: number;
  created_at?: string;
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
  ano?: number;
  created_at: string;
  updated_at: string;
  timeline?: TimelineEvent[];
  attachments?: Attachment[];
  comments?: Comment[];
}

export interface Comment {
  id: number;
  demand_id: string;
  user_id: number;
  user_name: string;
  body: string;
  created_at: string;
}

export interface SystemSettings {
  id?: number;
  organization_name?: string;
  primary_color?: string;
  accent_color?: string;
  logo_url?: string;
  sla_days_baixa?: number;
  sla_days_media?: number;
  sla_days_alta?: number;
  sla_days_urgente?: number;
  auto_triage?: boolean;
  email_notifications?: boolean;
  budget_cap?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface DashboardStats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byUf: { uf: string; count: number }[];
  totalValue: number;
  todayCount: number;
  overdue: number;
}

export interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  user_id: number;
  user_name: string;
  details: any;
  ip_address: string;
  user_agent: string;
  created_at: string;
}

export interface AuditDashboardStats {
  total_logins: number;
  failed_logins: number;
  active_users: number;
  active_sessions: number;
  pdf_exports: number;
  excel_exports: number;
  demands_created: number;
  demands_updated: number;
  demands_deleted: number;
  permission_changes: number;
  user_changes: number;
  logins_by_day: { day: string; count: string }[];
  changes_by_user: { user_name: string; count: string }[];
  demands_modified: { day: string; count: string }[];
  exports_done: { day: string; count: string }[];
}

export interface Session {
  id: number;
  user_id: number;
  user_name?: string;
  token_hash: string;
  ip_address: string;
  user_agent: string;
  browser: string;
  os: string;
  active: boolean;
  last_activity: string;
  created_at: string;
}

export interface Backup {
  id: number;
  filename: string;
  file_size: number;
  sha256_hash: string;
  backup_type: string;
  status: string;
  created_by: number;
  created_at: string;
}

export interface BackupCreateResult {
  id: number;
  filename: string;
  file_size: number;
  sha256_hash: string;
  backup_type: string;
  status: string;
  created_at: string;
}

export interface BackupVerifyResult {
  valid: boolean;
  stored_hash: string;
  computed_hash: string;
  filename: string;
}

export interface HealthCheck {
  server: { status: string; platform: string; cpu_cores: number; memory_usage_percent: number; total_memory_gb: number; free_memory_gb: number; uptime: string };
  database: { status: string; response_time_ms: number };
  api: { status: string; response_time_ms: number };
  app: { total_demands: number; active_users: number; last_backup: string | null; integrations_24h: number };
}

export interface MonitoringSnapshot {
  id: number;
  server_cpu: number;
  server_memory: number;
  api_response_time: number;
  db_connection_count: number;
  active_users: number;
  total_demands: number;
  last_backup_at: string | null;
  recorded_at: string;
}

export interface DemandVersion {
  id: number;
  version: number;
  snapshot: Record<string, unknown>;
  changed_by_name: string;
  ip_address: string;
  created_at: string;
}

export interface IntegrationInfo {
  api_url: string;
  version: string;
  endpoints: { path: string; method: string; description: string; auth: string }[];
}

export interface LgpdDashboard {
  users: { total: number; active: number; by_role: Record<string, number> };
  data_stored: { audit_logs: number; users: number; demands: number; comments: number; attachments: number };
  exports_30d: number;
  consent_rate: number;
}