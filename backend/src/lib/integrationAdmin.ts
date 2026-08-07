import { get, run, all } from '../database.js';
import { getAdapter } from './adapterRegistry.js';
import { processWebhookEvent } from './integrationProcessor.js';
import { logAudit, extractMeta } from './audit.js';
import { sanitizeIntegrationConfig } from './redact.js';

export { listAdapters } from './adapterRegistry.js';

/**
 * Backend administrativo do Módulo de Integrações (Fase 3.1 — Fase B).
 * Consultas de dashboard/saúde/histórico e orquestração da sincronização manual.
 * Reutiliza o motor existente (integrationProcessor + integrationSync + adapters).
 */

/** Latência acima deste valor (ms) marca o sistema como "atenção" no dashboard. */
export const LATENCY_WARNING_MS = 5000;

export type OverallStatus = 'healthy' | 'warning' | 'critical';
export type SystemHealthStatus = 'operational' | 'attention' | 'failure';

export interface DashboardData {
  total: number;
  active: number;
  inactive: number;
  lastSync: string | null;
  lastError: string | null;
  failures24h: number;
  status: OverallStatus;
}

export interface HealthStatusRow {
  id: number;
  name: string;
  status: SystemHealthStatus;
  lastSync: string | null;
  lastError: string | null;
  httpStatus: number | null;
  responseTime: number | null;
  failures: number;
}

export interface LogFilters {
  page?: number;
  limit?: number;
  systemId?: number;
  systemCode?: string;
  status?: string;
  direction?: string;
  from?: string;
  to?: string;
  hasError?: boolean;
  search?: string;
}

export interface LogsResult {
  data: any[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface ManualSyncResult {
  success: boolean;
  status: 'success' | 'warning' | 'error';
  durationMs: number;
  httpStatus: number | null;
  message: string;
  errorMessage: string | null;
  eventId?: number;
}

function systemHealthStatus(row: any): SystemHealthStatus {
  if (row.consecutive_errors > 0) return 'failure';
  if (row.error_count_24h > 0 || (row.last_response_ms ?? 0) >= LATENCY_WARNING_MS) return 'attention';
  return 'operational';
}

/** Redige valores sensíveis (segredos/tokens/senhas) de config antes de expor na API. */
function redactConfig(config: unknown): unknown {
  return sanitizeIntegrationConfig(config, false);
}

/** 1. Dashboard administrativo com o status geral das integrações. */
export async function getDashboard(): Promise<DashboardData> {
  const row = await get<any>(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE active)::int AS active,
       COUNT(*) FILTER (WHERE NOT active)::int AS inactive,
       MAX(last_sync_at) AS last_sync,
       MAX(last_error_at) AS last_error,
       COALESCE(SUM(error_count_24h), 0)::int AS failures_24h,
       COUNT(*) FILTER (WHERE consecutive_errors > 0)::int AS critical_count,
       COUNT(*) FILTER (WHERE consecutive_errors = 0 AND (error_count_24h > 0 OR last_response_ms >= $1))::int AS warning_count
     FROM integration_systems`,
    [LATENCY_WARNING_MS]
  );

  const critical = row?.critical_count ?? 0;
  const warning = row?.warning_count ?? 0;
  const status: OverallStatus = critical > 0 ? 'critical' : warning > 0 ? 'warning' : 'healthy';

  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    inactive: row?.inactive ?? 0,
    lastSync: row?.last_sync ?? null,
    lastError: row?.last_error ?? null,
    failures24h: row?.failures_24h ?? 0,
    status,
  };
}

/** 2. Saúde individual de cada sistema de integração. */
export async function getHealthList(): Promise<HealthStatusRow[]> {
  const rows = await all<any>(
    `SELECT id, name, active, last_sync_at, last_error_at, last_http_status, last_response_ms, error_count_24h, consecutive_errors
     FROM integration_systems
     ORDER BY name ASC`
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: systemHealthStatus(r),
    lastSync: r.last_sync_at ?? null,
    lastError: r.last_error_at ?? null,
    httpStatus: r.last_http_status ?? null,
    responseTime: r.last_response_ms ?? null,
    failures: r.consecutive_errors ?? 0,
  }));
}

/** 3. Histórico de execuções com paginação, filtros e busca. */
export async function getLogs(filters: LogFilters = {}): Promise<LogsResult> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.systemId) {
    conditions.push(`system_id = $${params.length + 1}`);
    params.push(filters.systemId);
  }
  if (filters.systemCode) {
    conditions.push(`system_code = $${params.length + 1}`);
    params.push(String(filters.systemCode).toLowerCase());
  }
  if (filters.status) {
    conditions.push(`status = $${params.length + 1}`);
    params.push(filters.status);
  }
  if (filters.direction) {
    conditions.push(`direction = $${params.length + 1}`);
    params.push(filters.direction);
  }
  if (filters.from) {
    conditions.push(`created_at >= $${params.length + 1}`);
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`created_at <= $${params.length + 1}`);
    params.push(filters.to);
  }
  if (filters.hasError) {
    conditions.push(`(status = 'error' OR error_message IS NOT NULL)`);
  }
  if (filters.search) {
    conditions.push(`(message ILIKE $${params.length + 1} OR system_code ILIKE $${params.length + 1})`);
    params.push(`%${filters.search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const countRow = await get<{ total: string }>(`SELECT COUNT(*) AS total FROM integration_logs ${whereClause}`, params);
  const total = parseInt(countRow?.total ?? '0', 10);

  params.push(limit, offset);
  const rows = await all<any>(
    `SELECT id, system_id, system_code, action, direction, status, duration_ms, http_status, message, response_summary, error_message, triggered_by, created_at
     FROM integration_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const data = rows.map((r) => ({
    id: r.id,
    system: { id: r.system_id, code: r.system_code },
    action: r.action,
    direction: r.direction,
    status: r.status,
    duration_ms: r.duration_ms ?? null,
    http_status: r.http_status ?? null,
    message: r.message ?? null,
    response_summary: r.response_summary ?? null,
    error_message: r.error_message ?? null,
    triggered_by: r.triggered_by ?? null,
    created_at: r.created_at,
  }));

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

/** 5. Detalhes de um sistema (nunca expõe secret_env_key/segredos). */
export async function getSystemDetail(id: number): Promise<any | null> {
  const row = await get<any>(
    `SELECT id, code, name, description, active, config, created_at, updated_at,
            last_sync_at, last_error_at, last_error_message, last_http_status, last_response_ms, error_count_24h, consecutive_errors
     FROM integration_systems
     WHERE id = $1`,
    [id]
  );
  if (!row) return null;

  const recentLogs = await all<any>(
    `SELECT id, system_code, action, direction, status, duration_ms, http_status, message, response_summary, error_message, triggered_by, created_at
     FROM integration_logs
     WHERE system_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [id]
  );

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: row.active,
    config: redactConfig(row.config),
    created_at: row.created_at,
    updated_at: row.updated_at,
    health: {
      status: systemHealthStatus(row),
      lastSync: row.last_sync_at ?? null,
      lastError: row.last_error_at ?? null,
      lastErrorMessage: row.last_error_message ?? null,
      httpStatus: row.last_http_status ?? null,
      responseTime: row.last_response_ms ?? null,
      errorCount24h: row.error_count_24h ?? 0,
      consecutiveErrors: row.consecutive_errors ?? 0,
    },
    recentLogs,
  };
}

/**
 * 4. Sincronização manual:
 * - payload informado  → roda o motor real (cria webhook_event + processWebhookEvent),
 *   reutilizando idempotência, persistência, timeline, vínculo e auditoria existentes;
 * - sem payload         → verificação de conectividade com config.endpoint (GET), se houver.
 * Em todos os casos grava integration_logs com os campos de execução da Fase 3.1,
 * atualiza as colunas de saúde e registra auditoria.
 */
export async function runManualSync(systemId: number, user: any, payload: unknown, req?: any): Promise<ManualSyncResult> {
  const system = await get<any>(
    `SELECT id, code, name, description, active, config FROM integration_systems WHERE id = $1`,
    [systemId]
  );
  if (!system) throw new Error('Sistema não encontrado');
  if (!system.active) throw new Error('Sistema inativo. Ative o sistema antes de sincronizar.');

  const startedAt = Date.now();
  const ip = req ? extractMeta(req).ip_address : 'unknown';
  const adapter = getAdapter(system.code);

  let result: ManualSyncResult;

  if (payload !== undefined && payload !== null) {
    if (typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Payload deve ser um objeto JSON');
    }
    if (!adapter) {
      throw new Error(`Nenhum adapter registrado para o sistema ${system.code}`);
    }

    const eventType = (payload as Record<string, any>).event || 'manual.sync';
    const idempotencyKey = `manual:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const inserted = await run(
      `INSERT INTO webhook_events (system_id, system_code, event_type, idempotency_key, payload, received_ip, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'pending')
       RETURNING id`,
      [system.id, system.code, String(eventType).slice(0, 100), idempotencyKey, JSON.stringify(payload), ip]
    );
    const eventId = inserted.rows[0].id as number;

    const processed = await processWebhookEvent(eventId, { triggeredBy: 'manual' });
    const durationMs = Date.now() - startedAt;

    if (processed.status === 'processed') {
      result = { success: true, status: 'success', durationMs, httpStatus: 200, message: 'Sincronização manual concluída', errorMessage: null, eventId };
    } else if (processed.status === 'unmatched') {
      result = { success: true, status: 'warning', durationMs, httpStatus: 200, message: processed.reason || 'Evento sem correspondência no SGD', errorMessage: null, eventId };
    } else {
      result = { success: false, status: 'error', durationMs, httpStatus: 502, message: 'Sincronização manual falhou', errorMessage: processed.reason || 'Falha na sincronização', eventId };
    }

    await run(
      `UPDATE integration_logs SET http_status = $1 WHERE webhook_event_id = $2 AND system_id = $3`,
      [result.httpStatus, eventId, system.id]
    );
  } else {
    const endpoint = system.config?.endpoint ? String(system.config.endpoint) : null;
    let httpStatus: number | null = null;
    let status: 'success' | 'warning' | 'error' = 'warning';
    let message: string;
    let errorMessage: string | null = null;

    if (endpoint) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const resp = await fetch(endpoint, { method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' } });
        httpStatus = resp.status;
        status = resp.ok ? 'success' : 'error';
        message = `Verificação de conectividade: HTTP ${resp.status}`;
        if (!resp.ok) errorMessage = `HTTP ${resp.status}`;
      } catch (err) {
        status = 'error';
        message = 'Verificação de conectividade falhou';
        errorMessage = `Falha de conexão: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        clearTimeout(timeout);
      }
    } else {
      message = 'Nenhum endpoint configurado (config.endpoint) para verificação de conectividade';
    }

    const durationMs = Date.now() - startedAt;
    result = { success: status === 'success', status, durationMs, httpStatus, message, errorMessage };

    await run(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message, duration_ms, http_status, response_summary, triggered_by, error_message)
       VALUES ($1, $2, 'out', 'integration.sync', $3, $4, $5, $6, $4, 'manual', $7)`,
      [system.id, system.code, status, message, durationMs, httpStatus, errorMessage]
    );
  }

  await updateSystemHealth(system.id, result);
  await logAudit(
    {
      entity_type: 'integration_system',
      entity_id: String(system.id),
      action: 'integration.sync.manual',
      user_id: user.id,
      user_name: user.name,
      details: {
        system: system.code,
        status: result.status,
        duration_ms: result.durationMs,
        http_status: result.httpStatus,
        message: result.message,
        ...(result.errorMessage ? { error_message: result.errorMessage } : {}),
      },
      ...extractMeta(req),
    },
  );

  return result;
}

/** Atualiza as colunas de saúde de integration_systems após uma sincronização. */
async function updateSystemHealth(systemId: number, result: ManualSyncResult): Promise<void> {
  if (result.status === 'success') {
    await run(
      `UPDATE integration_systems SET
         last_sync_at = NOW(), last_http_status = $2, last_response_ms = $3,
         consecutive_errors = 0, last_error_at = NULL, last_error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [systemId, result.httpStatus, result.durationMs]
    );
  } else if (result.status === 'warning') {
    await run(
      `UPDATE integration_systems SET
         last_sync_at = NOW(), last_http_status = $2, last_response_ms = $3, updated_at = NOW()
       WHERE id = $1`,
      [systemId, result.httpStatus, result.durationMs]
    );
  } else {
    await run(
      `UPDATE integration_systems SET
         last_sync_at = NOW(), last_http_status = $2, last_response_ms = $3,
         consecutive_errors = consecutive_errors + 1,
         last_error_at = NOW(), last_error_message = $4, updated_at = NOW()
       WHERE id = $1`,
      [systemId, result.httpStatus, result.durationMs, result.errorMessage]
    );
  }

  await run(
    `UPDATE integration_systems SET error_count_24h = (
       SELECT COUNT(*) FROM integration_logs WHERE system_id = $1 AND status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
     ) WHERE id = $1`,
    [systemId]
  );
}
