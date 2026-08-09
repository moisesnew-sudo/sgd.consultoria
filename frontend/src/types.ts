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

export interface ExecutiveStats {
  summary: {
    total: number;
    totalValue: number;
    avgValue: number;
    pending: number;
    inAnalysis: number;
    completed: number;
    rejected: number;
  };
  byUf: { uf: string; count: number; totalValue: number }[];
  byStatus: { status: string; count: number; totalValue: number }[];
  byOrgan: { organ: string; count: number; totalValue: number }[];
  byMunicipality: { municipality: string; uf: string; count: number; totalValue: number }[];
  byMonth: { month: string; count: number; totalValue: number }[];
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

// ============================================================
// Fase 3.1 — Administração de Integrações (Fase C1 - Frontend)
// ============================================================

export interface IntegrationDashboard {
  total: number;
  active: number;
  inactive: number;
  lastSync: string | null;
  lastError: string | null;
  failures24h: number;
  status: 'healthy' | 'warning' | 'critical';
}

export interface IntegrationHealth {
  id: number;
  name: string;
  status: 'operational' | 'attention' | 'failure';
  lastSync: string | null;
  lastError: string | null;
  httpStatus: number | null;
  responseTime: number | null;
  failures: number;
}

export interface IntegrationLogEntry {
  id: number;
  system: { id: number; code: string };
  action: string;
  direction: 'in' | 'out';
  status: 'success' | 'warning' | 'error';
  duration_ms: number | null;
  http_status: number | null;
  message: string | null;
  response_summary: string | null;
  error_message: string | null;
  triggered_by: string | null;
  created_at: string;
}

export interface IntegrationSystemDetail {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  health: {
    status: 'operational' | 'attention' | 'failure';
    lastSync: string | null;
    lastError: string | null;
    lastErrorMessage: string | null;
    httpStatus: number | null;
    responseTime: number | null;
    errorCount24h: number;
    consecutiveErrors: number;
  };
  recentLogs: IntegrationLogEntry[];
}

export interface IntegrationAdapter {
  code: string;
  name: string;
}

export interface IntegrationSyncResult {
  success: boolean;
  status: 'success' | 'warning' | 'error';
  durationMs: number;
  httpStatus: number | null;
  message: string;
  errorMessage: string | null;
  eventId?: number;
}

// ============================================================
// Fase E1.3 — Dashboard de Sincronização
// ============================================================

export interface SyncStatusSystem {
  id: number;
  code: string;
  name: string;
  active: boolean;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  consecutiveErrors: number;
  lastResponseMs: number | null;
  lastHttpStatus: number | null;
  errorCount24h: number;
  healthStatus: 'operational' | 'attention' | 'failure';
}

export interface SyncStatusData {
  systems: SyncStatusSystem[];
  summary: {
    total: number;
    syncEnabled: number;
    healthy: number;
    warning: number;
    failed: number;
  };
  scheduler: {
    running: boolean;
    lastCycleAt: string | null;
  };
}

export interface IntegrationLogsResponse {
  data: IntegrationLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================
// Fase E3.1 — Gestão Operacional de Integrações
// ============================================================

export type IntegrationHealthStatus = 'operational' | 'attention' | 'failure';
export type IntegrationOperationStatus = 'success' | 'warning' | 'error';

export interface IntegrationAlert {
  id: number;
  systemId: number;
  systemCode: string;
  systemName: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'open' | 'acknowledged';
  message: string | null;
  createdAt: string;
}

export interface IntegrationSystemStatus {
  id: number;
  code: string;
  name: string;
  active: boolean;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  healthStatus: IntegrationHealthStatus;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  httpStatus: number | null;
  responseTime: number | null;
  errorCount24h: number;
  consecutiveErrors: number;
  alerts: IntegrationAlert[];
}

export interface IntegrationHealthSummary {
  total: number;
  active: number;
  inactive: number;
  healthy: number;
  attention: number;
  failure: number;
  failures24h: number;
  openAlerts: number;
  avgLatencyMs: number | null;
  lastSync: string | null;
}

export interface IntegrationSchedulerStatus {
  running: boolean;
  lastCycleAt: string | null;
}

export interface IntegrationOverview {
  summary: IntegrationHealthSummary;
  systems: IntegrationSystemStatus[];
  alerts: IntegrationAlert[];
  scheduler: IntegrationSchedulerStatus;
}

export interface IntegrationOperationResult {
  success: boolean;
  status: IntegrationOperationStatus;
  durationMs: number;
  httpStatus: number | null;
  message: string;
  errorMessage: string | null;
  authenticated?: boolean | null;
  eventId?: number;
}

// ============================================================
// Fase 3.1 — Administração de Sistemas de Integração (Fase C4)
// ============================================================

export interface IntegrationSystem {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  secretConfigured: boolean;
}

export interface IntegrationSystemsResponse {
  data: IntegrationSystem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface IntegrationSystemFormData {
  code: string;
  name: string;
  description: string;
  secret_env_key: string;
  config: Record<string, unknown> | null;
  active: boolean;
}

export interface IntegrationSystemCreateData {
  code: string;
  name: string;
  description: string;
  secret_env_key: string;
  config?: Record<string, unknown> | null;
}

export interface IntegrationSystemUpdateData {
  name?: string;
  description?: string;
  config?: Record<string, unknown> | null;
}

// ============================================================
// D2.3 — Dashboard Operacional de Saúde
// ============================================================

export type ComponentStatus = 'ok' | 'degraded' | 'down';

export interface DatabaseHealth {
  status: ComponentStatus;
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
}

export interface ListenerHealth {
  status: ComponentStatus;
  connected: boolean;
  originId: string;
  lastNotificationAt: string | null;
  reconnectCount: number;
}

export interface EventBusHealth {
  status: ComponentStatus;
  eventsPublished: number;
  eventsReceived: number;
  errors: number;
  lastEventAt: string | null;
  activeListeners: number;
}

export interface SSEHealth {
  status: ComponentStatus;
  activeConnections: number;
  totalConnectionsOpened: number;
  totalConnectionsClosed: number;
  eventsSent: number;
  errors: number;
  lastConnectAt: string | null;
  lastDisconnectAt: string | null;
}

export interface SchedulerHealth {
  status: ComponentStatus;
  active: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastAlertsProcessed: number | null;
  lastError: string | null;
}

export interface SystemHealthAlert {
  id: number;
  severity: string;
  type: string;
  message: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
}

export interface SystemHealthResponse {
  status: ComponentStatus;
  timestamp: string;
  uptime: number;
  version: string;
  database: DatabaseHealth;
  postgresListener: ListenerHealth;
  eventBus: EventBusHealth;
  sse: SSEHealth;
  scheduler: SchedulerHealth;
  alerts: {
    items: SystemHealthAlert[];
    openCount: number;
    acknowledgedCount: number;
    total: number;
  };
}

/* ------------------------------------------------------------------ */
/* D3.2 — Outbound Webhooks                                           */
/* ------------------------------------------------------------------ */

export type WebhookDeliveryStatus = 'pending' | 'sending' | 'success' | 'failed' | 'retrying' | 'dead_letter';

export interface OutboundWebhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  webhook_name: string;
  event_type: string;
  url: string;
  request_headers: Record<string, string> | null;
  request_body: unknown;
  response_status: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt: number;
  max_attempts: number;
  status: WebhookDeliveryStatus;
  error: string | null;
  delivery_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface WebhookStats {
  totalWebhooks: number;
  activeWebhooks: number;
  last24h: {
    total: number;
    success: number;
    failed: number;
    dead_letter: number;
  };
  totalDeadLetter: number;
  topDeadLetterWebhooks: {
    webhookId: number;
    webhookName: string;
    deadLetterCount: number;
    lastFailedAt: string | null;
  }[];
}