/**
 * Fase D1.3 + E2.2 — Motor de Alertas Inteligentes do SGD (regras R1–R10).
 *
 * O motor NÃO é uma nova fonte de verdade de health: avalia exclusivamente o
 * estado persistido pelas rotinas existentes (integration_systems como fonte
 * de saúde, integration_logs e webhook_events como evidência operacional) e
 * materializa os alertas em integration_alerts.
 *
 * E2.2 adicionou R9 (auth_failure) e R10 (api_unavailable): falha de
 * autenticação (HTTP 401/403) e API indisponível (HTTP 0 — baseUrl não
 * configurada ou conexão recusada).
 *
 * Diretrizes implementadas:
 * - Deduplicação determinística via índice parcial UNIQUE (system_id, type)
 *   WHERE status IN ('open','acknowledged') — nunca depende de memória;
 * - Coalescing: quando a mesma condição persiste, atualiza o alerta ativo
 *   (occurrences, lastDetectedAt, firstDetectedAt preservado) em vez de criar;
 * - Recovery (R8): resolve apenas com evidência de recuperação real, nunca por
 *   ausência de dados;
 * - Precedência de severidade critical > warning > info; regras com o mesmo
 *   sintoma são suprimidas pela mais grave (R2 suprime R4; R3 suprime R6);
 * - Segurança: details contém apenas contexto operacional. Nunca ler config
 *   para montar alertas; adicionalmente, redactSensitiveDetails() é aplicada
 *   como rede de segurança antes da persistência.
 *
 * Auditoria: o motor roda em background, sem usuário autenticado. Por isso NÃO
 * inventa usuário em audit_logs — registra contexto operacional no próprio
 * alerta (details) e deixa a auditoria de ações administrativas (ack/resolve
 * por usuário) para a Fase D1.5.
 */

import { all, run } from '../database.js';
import { REDACTED_VALUE, SENSITIVE_CONFIG_KEY_RE } from './redact.js';
import { logger } from './logger.js';

/* ------------------------------------------------------------------ */
/* Constantes das regras (R1–R10).                                     */
/* ------------------------------------------------------------------ */

export const WINDOW_HOURS = 24;
export const CONSECUTIVE_FAILURES_THRESHOLD = 3;
export const HTTP_5XX_STATUS = 500;
export const HTTP_5XX_ERRORS_24H = 3;
export const ERROR_SPIKE_THRESHOLD_24H = 5;
export const LATENCY_WARNING_MS = 5000;
export const STALE_SYNC_HOURS = 24;
/** Status HTTP que indicam falha de autenticação. */
export const AUTH_FAILURE_STATUS = [401, 403] as const;
/** Status HTTP que indicam API indisponível (0 = conexão/baseUrl recusada). */
export const API_UNAVAILABLE_STATUS = 0;

export const ALERT_TYPES = [
  'consecutive_failures',
  'http_5xx',
  'system_inactive',
  'error_spike',
  'high_latency',
  'stale_sync',
  'unmatched_events',
  'auth_failure',
  'api_unavailable',
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export type AlertSeverity = 'critical' | 'warning' | 'info';

/* ------------------------------------------------------------------ */
/* Tipos do domínio.                                                  */
/* ------------------------------------------------------------------ */

export interface SystemSnapshot {
  id: number;
  code: string;
  name: string;
  tenantId: number;
  active: boolean;
  /** Última sincronização — string ISO ou Date (driver pg para TIMESTAMPTZ). */
  lastSyncAt: string | Date | null;
  lastHttpStatus: number | null;
  lastResponseMs: number | null;
  errorCount24h: number;
  consecutiveErrors: number;
}

export interface UnmatchedInfo {
  count: number;
  lastUnmatchedAt: string | null;
}

export interface RuleMatch {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  /** Tipos que esta regra suprime (mesmo sintoma, regra mais grave prevalece). */
  suppresses?: AlertType[];
}

export interface ActiveAlertView {
  id: number;
  systemId: number;
  type: AlertType;
  severity: AlertSeverity;
  status: 'open' | 'acknowledged';
  details: Record<string, unknown> | null;
}

export interface RecoveryDecision {
  shouldResolve: boolean;
  reason: string;
}

/** Contexto por sistema: dados operacionais levantados do banco para a rodada. */
export interface EvaluationContext {
  now: Date;
  unmatched?: UnmatchedInfo;
  /** Evidência de mapeamento corrigido: >= 1 webhook processado nas últimas 24h (R7 recovery). */
  recentProcessed24h?: boolean;
  /** Evidência de execução bem-sucedida: >= 1 log success nas últimas 24h (R1/R2/R4/R5 recovery). */
  hasRecentSuccess?: boolean;
}

export interface AlertEvaluationSummary {
  evaluatedSystems: number;
  created: number;
  updated: number;
  resolved: number;
  skipped: number;
}

export interface EvaluationOptions {
  /** Momento de referência da rodada (default: agora). Injeta determinismo nos testes. */
  now?: Date;
  /** Se informado, avalia apenas estes sistemas (isolamento de testes/jobs parciais). */
  systemIds?: number[];
}

/* ------------------------------------------------------------------ */
/* Utilidades.                                                        */
/* ------------------------------------------------------------------ */

function hoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

/** Redige recursivamente qualquer chave sensível antes de persistir em details. */
export function redactSensitiveDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (SENSITIVE_CONFIG_KEY_RE.test(k)) {
      out[k] = REDACTED_VALUE;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = redactSensitiveDetails(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function baseDetails(matchType: AlertType, system: SystemSnapshot, ctx: EvaluationContext): Record<string, unknown> {
  return {
    rule: matchType,
    type: matchType,
    lastDetectedAt: ctx.now.toISOString(),
    currentValue: null,
    threshold: null,
    lastHttpStatus: system.lastHttpStatus ?? null,
    errorCount24h: system.errorCount24h,
    consecutiveErrors: system.consecutiveErrors,
  };
}

function withOccurrences(
  base: Record<string, unknown>,
  existing: ActiveAlertView | undefined,
  ctx: EvaluationContext
): Record<string, unknown> {
  const previous = existing?.details && typeof existing.details === 'object' ? existing.details : {};
  const occurrences = (typeof previous.occurrences === 'number' ? previous.occurrences : 0) + 1;
  const firstDetectedAt =
    typeof previous.firstDetectedAt === 'string'
      ? previous.firstDetectedAt
      : ctx.now.toISOString();
  return { ...base, occurrences, firstDetectedAt };
}

/* ------------------------------------------------------------------ */
/* Funções PURAS das regras (testáveis sem banco).                    */
/* ------------------------------------------------------------------ */

/**
 * Avalia R1–R10 para um sistema. NÃO faz I/O: apenas deriva quais regras
 * disparam a partir do snapshot de saúde + contexto de eventos.
 */
export function evaluateRules(system: SystemSnapshot, ctx: EvaluationContext): RuleMatch[] {
  const matches: RuleMatch[] = [];

  // R1 — Falhas consecutivas (critical)
  if (system.consecutiveErrors >= CONSECUTIVE_FAILURES_THRESHOLD) {
    matches.push({
      type: 'consecutive_failures',
      severity: 'critical',
      message: `Falhas consecutivas em ${system.name}: ${system.consecutiveErrors} falhas seguidas (limite ${CONSECUTIVE_FAILURES_THRESHOLD})`,
      details: {
        ...baseDetails('consecutive_failures', system, ctx),
        currentValue: system.consecutiveErrors,
        threshold: CONSECUTIVE_FAILURES_THRESHOLD,
      },
    });
  }

  // R2 — HTTP 5xx recorrente (critical). Suprime R4 (error_spike): ambos derivam
  // de error_count_24h; quando os dois disparam, a regra crítica prevalece e o
  // warning não vira ruído independente para o mesmo sintoma.
  if ((system.lastHttpStatus ?? 0) >= HTTP_5XX_STATUS && system.errorCount24h >= HTTP_5XX_ERRORS_24H) {
    matches.push({
      type: 'http_5xx',
      severity: 'critical',
      message: `HTTP ${system.lastHttpStatus} recorrente em ${system.name}: ${system.errorCount24h} erros nas últimas 24h`,
      details: {
        ...baseDetails('http_5xx', system, ctx),
        currentValue: system.lastHttpStatus ?? null,
        threshold: HTTP_5XX_STATUS,
        http5xxErrors24h: HTTP_5XX_ERRORS_24H,
      },
      suppresses: ['error_spike'],
    });
  }

  // R3 — Sistema inativo inesperado (critical). Alerta de ESTADO administrativo:
  // criado uma única vez por ocorrência; o motor não o reescreve a cada rodada.
  if (!system.active) {
    matches.push({
      type: 'system_inactive',
      severity: 'critical',
      message: `Sistema ${system.name} está inativo`,
      details: {
        rule: 'system_inactive',
        type: 'system_inactive',
        currentValue: 'inactive',
        lastDetectedAt: ctx.now.toISOString(),
      },
      suppresses: ['stale_sync'],
    });
  }

  // R4 — Aumento de erros (warning). Suprimido por R2 quando ambos disparam.
  if (system.errorCount24h >= ERROR_SPIKE_THRESHOLD_24H) {
    matches.push({
      type: 'error_spike',
      severity: 'warning',
      message: `Pico de erros em ${system.name}: ${system.errorCount24h} erros nas últimas 24h (limite ${ERROR_SPIKE_THRESHOLD_24H})`,
      details: {
        ...baseDetails('error_spike', system, ctx),
        currentValue: system.errorCount24h,
        threshold: ERROR_SPIKE_THRESHOLD_24H,
      },
    });
  }

  // R5 — Latência elevada (warning).
  if (system.lastResponseMs !== null && system.lastResponseMs >= LATENCY_WARNING_MS) {
    matches.push({
      type: 'high_latency',
      severity: 'warning',
      message: `Latência elevada em ${system.name}: ${system.lastResponseMs}ms (limite ${LATENCY_WARNING_MS}ms)`,
      details: {
        ...baseDetails('high_latency', system, ctx),
        currentValue: system.lastResponseMs,
        threshold: LATENCY_WARNING_MS,
      },
    });
  }

  // R6 — Staleness de sincronização (warning). Apenas sistemas ATIVOS:
  // sistemas inativos deliberados são tratados por R3 (evita falso positivo).
  if (system.active) {
    const stale =
      system.lastSyncAt === null ||
      nowMinusMillis(system.lastSyncAt, ctx.now) >= STALE_SYNC_HOURS * 60 * 60 * 1000;
    if (stale) {
      matches.push({
        type: 'stale_sync',
        severity: 'warning',
        message: `Sincronização defasada em ${system.name}: último sync ${system.lastSyncAt ? `em ${formatSyncDate(system.lastSyncAt)}` : 'nunca realizado'} (limite ${STALE_SYNC_HOURS}h)`,
        details: {
          ...baseDetails('stale_sync', system, ctx),
          currentValue: system.lastSyncAt,
          thresholdHours: STALE_SYNC_HOURS,
        },
      });
    }
  }

  // R7 — Eventos sem mapeamento (warning), janela de 24h.
  if (ctx.unmatched && ctx.unmatched.count >= 1) {
    matches.push({
      type: 'unmatched_events',
      severity: 'warning',
      message: `${ctx.unmatched.count} evento(s) sem mapeamento em ${system.name} nas últimas ${WINDOW_HOURS}h`,
      details: {
        rule: 'unmatched_events',
        type: 'unmatched_events',
        currentValue: ctx.unmatched.count,
        threshold: 1,
        unmatchedCount: ctx.unmatched.count,
        lastUnmatchedAt: ctx.unmatched.lastUnmatchedAt,
        windowHours: WINDOW_HOURS,
        lastDetectedAt: ctx.now.toISOString(),
      },
    });
  }

  // R9 — Falha de autenticação (critical). HTTP 401/403 registrado no último
  // sync indica credencial inválida/expirada: integração bloqueada até correção.
  if (system.lastHttpStatus !== null && (AUTH_FAILURE_STATUS as readonly number[]).includes(system.lastHttpStatus)) {
    matches.push({
      type: 'auth_failure',
      severity: 'critical',
      message: `Falha de autenticação em ${system.name}: HTTP ${system.lastHttpStatus} no último sync (revise credenciais)`,
      details: {
        ...baseDetails('auth_failure', system, ctx),
        currentValue: system.lastHttpStatus,
      },
    });
  }

  // R10 — API indisponível (critical). HTTP 0 = baseUrl não configurada ou
  // conexão recusada na última tentativa: integração fora do ar.
  if (system.lastHttpStatus !== null && system.lastHttpStatus === API_UNAVAILABLE_STATUS) {
    matches.push({
      type: 'api_unavailable',
      severity: 'critical',
      message: `API indisponível para ${system.name}: conexão recusada (baseUrl/configuração) no último sync`,
      details: {
        ...baseDetails('api_unavailable', system, ctx),
        currentValue: system.lastHttpStatus,
      },
    });
  }

  return matches;
}

/**
 * Formata o dia (YYYY-MM-DD) de lastSyncAt para mensagens de alerta.
 * lastSyncAt pode ser string ISO (testes/fixtures) ou Date (retornado pelo
 * driver pg para a coluna TIMESTAMPTZ last_sync_at).
 */
function formatSyncDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}

function nowMinusMillis(iso: string | Date | null, now: Date): number {
  if (iso === null) return 0;
  return now.getTime() - new Date(iso).getTime();
}

/**
 * Aplica a precedência de severidade entre regras simultâneas.
 * Regra documentada: quando duas regras representam o mesmo sintoma, a de
 * severidade maior prevalece e a menor é descartada (R2 suprime R4; R3 suprime R6).
 * Regras com problemas DISTINTOS permanecem independentes (ex.: R1 + R5).
 */
export function applyRuleSuppression(matches: RuleMatch[]): RuleMatch[] {
  const suppressed = new Set<AlertType>();
  for (const match of matches) {
    for (const target of match.suppresses ?? []) suppressed.add(target);
  }
  return matches.filter((m) => !suppressed.has(m.type));
}

/** Verifica se a condição da regra do alerta ainda vigora (fonte: estado atual). */
export function conditionStillHolds(alertType: AlertType, system: SystemSnapshot, ctx: EvaluationContext): boolean {
  switch (alertType) {
    case 'consecutive_failures':
      return system.consecutiveErrors >= CONSECUTIVE_FAILURES_THRESHOLD;
    case 'http_5xx':
      return (system.lastHttpStatus ?? 0) >= HTTP_5XX_STATUS && system.errorCount24h >= HTTP_5XX_ERRORS_24H;
    case 'system_inactive':
      return !system.active;
    case 'error_spike':
      return system.errorCount24h >= ERROR_SPIKE_THRESHOLD_24H;
    case 'high_latency':
      return system.lastResponseMs !== null && system.lastResponseMs >= LATENCY_WARNING_MS;
    case 'stale_sync':
      return system.active && (system.lastSyncAt === null || nowMinusMillis(system.lastSyncAt, ctx.now) >= STALE_SYNC_HOURS * 60 * 60 * 1000);
    case 'unmatched_events':
      return (ctx.unmatched?.count ?? 0) >= 1;
    case 'auth_failure':
      return system.lastHttpStatus !== null && (AUTH_FAILURE_STATUS as readonly number[]).includes(system.lastHttpStatus);
    case 'api_unavailable':
      return system.lastHttpStatus !== null && system.lastHttpStatus === API_UNAVAILABLE_STATUS;
    default:
      return true;
  }
}

/**
 * R8 — Recovery. Resolve o alerta ativo SOMENTE se (a) a condição não vigora
 * mais e (b) existe evidência de recuperação real. Sem evidência, o alerta
 * permanece aberto (não resolver por query vazia / decadência natural).
 */
export function evaluateRecovery(
  alert: ActiveAlertView,
  system: SystemSnapshot,
  ctx: EvaluationContext
): RecoveryDecision {
  if (conditionStillHolds(alert.type, system, ctx)) {
    return { shouldResolve: false, reason: 'condição ainda vigora' };
  }

  switch (alert.type) {
    // A evidência é a própria mudança administrativa (active de volta a TRUE).
    case 'system_inactive':
      return { shouldResolve: true, reason: 'sistema reativado' };
    // A evidência é um sync recente (last_sync_at atualizado por execução real).
    case 'stale_sync':
      return { shouldResolve: true, reason: 'last_sync_at atualizado dentro da janela' };
    // Evidência: um evento passou a ser processado (mapeamento corrigido),
    // além de não haver mais eventos sem mapeamento na janela.
    case 'unmatched_events':
      return ctx.recentProcessed24h
        ? { shouldResolve: true, reason: 'sem eventos sem mapeamento na janela e mapeamento corrigido' }
        : { shouldResolve: false, reason: 'sem evidência de correção (nenhum evento processado nas últimas 24h)' };
    // Regras baseadas em erros/latência: exigem execução bem-sucedida recente.
    default:
      return ctx.hasRecentSuccess
        ? { shouldResolve: true, reason: 'condição cessou após execução bem-sucedida' }
        : { shouldResolve: false, reason: 'sem evidência de execução bem-sucedida nas últimas 24h' };
  }
}

/* ------------------------------------------------------------------ */
/* Acesso a dados (I/O).                                              */
/* ------------------------------------------------------------------ */

function buildScopeClause(
  systemIds?: number[],
  paramOffset: number = 0,
  column: string = 'system_id'
): { clause: string; params: number[] } {
  if (!systemIds || systemIds.length === 0) return { clause: '', params: [] };
  const placeholders = systemIds.map((_, i) => `$${paramOffset + i + 1}`).join(', ');
  return { clause: ` AND ${column} IN (${placeholders})`, params: systemIds };
}

async function loadSystems(now: Date, systemIds?: number[]): Promise<SystemSnapshot[]> {
  const scope = buildScopeClause(systemIds, 0, 'id');
  const rows = await all<any>(
    `SELECT id, code, name, tenant_id, active, last_sync_at, last_http_status, last_response_ms,
            error_count_24h, consecutive_errors
     FROM integration_systems
     WHERE 1 = 1${scope.clause}
     ORDER BY id ASC`,
    scope.params
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    tenantId: r.tenant_id ?? 1,
    active: !!r.active,
    lastSyncAt: r.last_sync_at ?? null,
    lastHttpStatus: r.last_http_status ?? null,
    lastResponseMs: r.last_response_ms ?? null,
    errorCount24h: r.error_count_24h ?? 0,
    consecutiveErrors: r.consecutive_errors ?? 0,
  }));
}

/** Eventos sem mapeamento nas últimas 24h, agrupados por sistema. */
export async function loadUnmatchedEvents(now: Date, systemIds?: number[]): Promise<Map<number, UnmatchedInfo>> {
  const scope = buildScopeClause(systemIds, 1);
  const rows = await all<any>(
    `SELECT system_id,
            COUNT(*)::int AS count,
            MAX(received_at) AS last_unmatched_at
     FROM webhook_events
     WHERE status = 'unmatched' AND received_at >= $1${scope.clause}
     GROUP BY system_id`,
    [hoursAgo(now, WINDOW_HOURS), ...scope.params]
  );
  const map = new Map<number, UnmatchedInfo>();
  for (const r of rows) {
    map.set(r.system_id, { count: r.count, lastUnmatchedAt: r.last_unmatched_at ?? null });
  }
  return map;
}

/** Sistemas com ao menos um webhook processado nas últimas 24h (evidência R7). */
async function loadRecentProcessedSystems(now: Date, systemIds?: number[]): Promise<Set<number>> {
  const scope = buildScopeClause(systemIds, 1);
  const rows = await all<{ system_id: number }>(
    `SELECT DISTINCT system_id FROM webhook_events
     WHERE status = 'processed' AND received_at >= $1${scope.clause}`,
    [hoursAgo(now, WINDOW_HOURS), ...scope.params]
  );
  return new Set(rows.map((r) => r.system_id));
}

/** Sistemas com ao menos um log de sucesso nas últimas 24h (evidência R1/R2/R4/R5). */
async function loadRecentSuccessSystems(now: Date, systemIds?: number[]): Promise<Set<number>> {
  const scope = buildScopeClause(systemIds, 1);
  const rows = await all<{ system_id: number }>(
    `SELECT DISTINCT system_id FROM integration_logs
     WHERE status = 'success' AND created_at >= $1${scope.clause}`,
    [hoursAgo(now, WINDOW_HOURS), ...scope.params]
  );
  return new Set(rows.map((r) => r.system_id));
}

async function loadActiveAlerts(systemIds?: number[]): Promise<ActiveAlertView[]> {
  const scope = buildScopeClause(systemIds);
  const rows = await all<any>(
    `SELECT id, system_id, type, severity, status, details
     FROM integration_alerts
     WHERE status IN ('open', 'acknowledged')${scope.clause}`,
    scope.params
  );
  return rows.map((r) => ({
    id: r.id,
    systemId: r.system_id,
    type: r.type,
    severity: r.severity,
    status: r.status,
    details: r.details && typeof r.details === 'object' ? r.details : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Escrita (atômica, determinística, usa a garantia do banco).        */
/* ------------------------------------------------------------------ */

/**
 * Cria ou atualiza (coalesce) o alerta ativo de um tipo para o sistema.
 * - Sem alerta ativo -> INSERT (created);
 * - Com alerta ativo  -> UPDATE preservando status (open/acknowledged) e o
 *   histórico firstDetectedAt/occurrences (updated);
 * - R3 (system_inactive) é um estado administrativo: ON CONFLICT DO NOTHING,
 *   sem reescrita a cada rodada (não duplica nem gera ruído).
 */
async function upsertAlert(
  match: RuleMatch,
  system: SystemSnapshot,
  existing: ActiveAlertView | undefined,
  ctx: EvaluationContext,
  count: AlertEvaluationSummary
): Promise<void> {
  const details = redactSensitiveDetails(withOccurrences(match.details, existing, ctx));

  if (match.type === 'system_inactive') {
    const result = await run(
      `INSERT INTO integration_alerts (system_id, severity, type, message, details, status, tenant_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'open', $6)
       ON CONFLICT (system_id, type) WHERE status IN ('open', 'acknowledged') DO NOTHING
       RETURNING id`,
      [system.id, match.severity, match.type, match.message, JSON.stringify(details), system.tenantId]
    );
    if (result.rows[0]) {
      count.created += 1;
      logger.info('Alerta criado', { system: system.code, type: match.type, severity: match.severity });
    } else {
      count.skipped += 1; // R3 persistente — não reescrever a cada avaliação
    }
    return;
  }

  const result = await run(
    `INSERT INTO integration_alerts (system_id, severity, type, message, details, status, tenant_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'open', $6)
     ON CONFLICT (system_id, type) WHERE status IN ('open', 'acknowledged')
     DO UPDATE SET
       severity = EXCLUDED.severity,
       message = EXCLUDED.message,
       details = jsonb_set(
         jsonb_set(
           COALESCE(integration_alerts.details, '{}'::jsonb) || EXCLUDED.details,
           '{occurrences}',
           to_jsonb((COALESCE(integration_alerts.details->>'occurrences', '0')::int + 1))
         ),
         '{firstDetectedAt}',
         COALESCE(integration_alerts.details->'firstDetectedAt', EXCLUDED.details->'firstDetectedAt')
       ),
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [system.id, match.severity, match.type, match.message, JSON.stringify(details), system.tenantId]
  );

  const row = result.rows[0];
  if (!row) {
    count.skipped += 1;
    return;
  }
  if (row.inserted === true || row.inserted === 't') {
    count.created += 1;
    logger.info('Alerta criado', { system: system.code, type: match.type, severity: match.severity });
  } else {
    count.updated += 1;
  }
}

/** R8 — resolve um alerta ativo com registro de recuperação em details. */
async function resolveAlert(
  alert: ActiveAlertView,
  system: SystemSnapshot,
  reason: string,
  ctx: EvaluationContext,
  count: AlertEvaluationSummary
): Promise<void> {
  const previous = alert.details && typeof alert.details === 'object' ? alert.details : {};
  const resolvedDetails = redactSensitiveDetails({
    ...previous,
    recovery: true,
    recoveredAt: ctx.now.toISOString(),
    previousSeverity: alert.severity,
    recoveryReason: reason,
  });

  const result = await run(
    `UPDATE integration_alerts
     SET status = 'resolved', resolved_at = NOW(), details = $2::jsonb, updated_at = NOW()
     WHERE id = $1 AND status IN ('open', 'acknowledged')`,
    [alert.id, JSON.stringify(resolvedDetails)]
  );

  if (result.rowCount && result.rowCount > 0) {
    count.resolved += 1;
    logger.info('Alerta resolvido', { system: system.code, type: alert.type, reason });
  } else {
    count.skipped += 1; // já resolvido por outro processo
  }
}

/* ------------------------------------------------------------------ */
/* Orquestração.                                                      */
/* ------------------------------------------------------------------ */

/**
 * Roda uma avaliação completa das integrações e retorna um resumo.
 * Fase D1.4 acoplará esta função ao job periódico do servidor (setInterval +
 * pg_advisory_lock). Chamar manualmente já é seguro e idempotente.
 */
export async function runAlertEvaluation(options: EvaluationOptions = {}): Promise<AlertEvaluationSummary> {
  const now = options.now ?? new Date();
  const summary: AlertEvaluationSummary = { evaluatedSystems: 0, created: 0, updated: 0, resolved: 0, skipped: 0 };

  const systems = await loadSystems(now, options.systemIds);
  const systemIds = systems.map((s) => s.id);
  const unmatchedBySystem = await loadUnmatchedEvents(now, systemIds.length > 0 ? systemIds : undefined);
  const recentProcessed = await loadRecentProcessedSystems(now, systemIds.length > 0 ? systemIds : undefined);
  const recentSuccess = await loadRecentSuccessSystems(now, systemIds.length > 0 ? systemIds : undefined);
  const activeAlerts = await loadActiveAlerts(systemIds.length > 0 ? systemIds : undefined);

  const alertsBySystem = new Map<number, ActiveAlertView[]>();
  for (const alert of activeAlerts) {
    const list = alertsBySystem.get(alert.systemId) ?? [];
    list.push(alert);
    alertsBySystem.set(alert.systemId, list);
  }
  const activeBySystemAndType = new Map<string, ActiveAlertView>();
  for (const alert of activeAlerts) {
    activeBySystemAndType.set(`${alert.systemId}:${alert.type}`, alert);
  }

  for (const system of systems) {
    summary.evaluatedSystems += 1;

    const ctx: EvaluationContext = {
      now,
      unmatched: unmatchedBySystem.get(system.id),
      recentProcessed24h: recentProcessed.has(system.id),
      hasRecentSuccess: recentSuccess.has(system.id),
    };

    const matches = applyRuleSuppression(evaluateRules(system, ctx));
    const matchedTypes = new Set(matches.map((m) => m.type));

    for (const match of matches) {
      const existing = activeBySystemAndType.get(`${system.id}:${match.type}`);
      await upsertAlert(match, system, existing, ctx, summary);
    }

    for (const alert of alertsBySystem.get(system.id) ?? []) {
      if (matchedTypes.has(alert.type)) continue; // já tratado no coalesce acima
      const decision = evaluateRecovery(alert, system, ctx);
      if (decision.shouldResolve) {
        await resolveAlert(alert, system, decision.reason, ctx, summary);
      } else {
        summary.skipped += 1;
      }
    }
  }

  return summary;
}

export default { runAlertEvaluation, evaluateRules, applyRuleSuppression, evaluateRecovery, redactSensitiveDetails };
