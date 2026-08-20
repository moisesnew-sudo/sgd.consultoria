/**
 * Motor de snapshot do SEI (A7.3 + A7.4, padrão do Transferegov).
 *
 * Arquitetura: coleta completa em memória → validação do snapshot →
 * cálculo da reconciliação → publicação atômica (BEGIN → persistência →
 * reconciliação → COMMIT) com ROLLBACK em erro.
 * Nenhuma transação de banco fica aberta durante chamadas HTTP.
 *
 * Identidade dos registros: external_id = NUP (Número Único de Protocolo,
 * formato NNNNN.NNNNNN/AAAA-XX), obrigatório, não vazio, único e
 * determinístico. A comparação entre snapshots usa (system_id + external_id),
 * nunca nome, proposta, status ou posição na paginação.
 *
 * Concorrência: reutiliza o advisory lock existente do ciclo de sincronização
 * (SYNC_LOCK_KEY de integrationScheduler) — nenhum novo mecanismo de lock.
 *
 * A7.4 — Reconciliação segura (reversível e auditável):
 *  - Registros presentes no snapshot atual são UPSERT (sem apagar nada);
 *  - Registros presentes em snapshot anterior mas AUSENTES do snapshot atual
 *    recebem absent_since = NOW() — NUNCA são apagados fisicamente;
 *  - A reconciliação de ausentes só acontece para snapshot COMPLETO e validado,
 *    dentro da mesma transação da publicação (tudo ou nada);
 *  - Execuções limitadas (maxRecordsPerSync) ou com erro não reconciliam ausentes;
 *  - demand_integrations NUNCA é alterado por este motor (vínculos preservados)
 *    e registros sem demanda correspondente permanecem em integration_snapshots.
 *
 * A7.4 Parte 2 — Auditoria:
 *  - Cada execução registra um estado explícito (PUBLISHED | LIMITED | FAILED |
 *    SKIPPED) em integration_logs com métricas essenciais (JSONB, sem segredos);
 *  - O registro de auditoria é escrito FORA da transação de publicação — um
 *    ROLLBACK nunca apaga a evidência da tentativa.
 *
 * STATUS DO CONTRATO: INFERIDO / PENDENTE DE HOMOLOGAÇÃO.
 *  - Contrato de consulta (polling) NÃO confirmado por um endpoint oficial:
 *    assume-se o recurso de listagem paginada `GET {baseUrl}/api/v1/processos`
 *    com envelope { data: [...], total_pages, total_items }, espelhando o
 *    contrato validado do Transferegov (padrão documentado da integração).
 *    Uma resposta sem envelope (array direto) também é aceita como página
 *    única (total_pages = 1) — tolerância do contrato inferido.
 *  - Itens SEM NUP na listagem são IGNORADOS (não invalidam o snapshot);
 *    apenas registros com NUP válido são publicados.
 *  - Não existe (ainda) endpoint de data-atualizacao para o SEI: a execução
 *    sempre coleta o snapshot completo (sem otimização SKIPPED por base
 *    inalterada). O estado SKIPPED só ocorre por bloqueio de advisory lock.
 *  - A validação de NUP segue o formato oficial NNNNN.NNNNNN/AAAA-XX já
 *    aplicado pelo adapter (sei.adapter.ts#validate).
 *  - O status de contrato é registrado nas métricas de auditoria
 *    (metrics.api_contract = 'inferred').
 *  - Em produção, o snapshot deve ser habilitado somente após a homologação
 *    do endpoint real disponibilizado pelo órgão (SEI_BASE_URL).
 */
import type { PoolClient } from 'pg';
import { pool, run, get, transaction } from '../database.js';
import { getGovAdapter } from '../lib/adapterRegistry.js';
import { logger } from '../lib/logger.js';
import { SYNC_LOCK_KEY } from '../lib/integrationScheduler.js';
import {
  flattenPayload,
  pickString,
  type AdapterConfig,
  type GovernmentIntegrationAdapter,
  type NormalizedIntegrationEvent,
} from './types.js';

/** Máximo de registros por página aceito pela API. */
const MAX_PAGE_SIZE = 200;
/** Primeira página da API. */
const FIRST_PAGE = 1;
/** Chaves do identificador de processo no contrato do SEI (NUP). */
const SEI_NUP_KEYS = ['numero_processo', 'process_number', 'processNumber', 'processo', 'nup'];
/** Formato oficial de NUP (Número Único de Protocolo). */
const NUP_PATTERN = /^\d{5}\.\d{6}\/\d{4}-\d{2}$/;

/** Registro de snapshot persistido/publicado. */
export interface SeiSnapshotRecord {
  /** Identidade determinística do registro = NUP. */
  externalId: string;
  /** Número da proposta (quando presente). */
  proposalNumber?: string;
  /** Status externo normalizado (CAIXA ALTA, sem acentos). */
  externalStatus?: string;
  /** Status externo original (como retornado pela API). */
  rawStatus?: string;
  /** Payload original do item, preservado para auditoria. */
  payload: unknown;
}

/** Parâmetros da execução de snapshot. */
export interface SeiSnapshotParams {
  /** Limite máximo de registros por execução (maxRecordsPerSync). Quando atingido, a coleta é interrompida e o resultado é parcial (não publicado como completo). */
  maxRecords?: number;
  /**
   * Quando true, indica que o advisory lock (SYNC_LOCK_KEY) já foi adquirido
   * pelo chamador (ex.: integrationScheduler). O snapshot engine NÃO tenta
   * adquirir novamente o lock — nem cria PoolClient exclusivamente para isso,
   * nem executa pg_advisory_unlock no finally.
   *
   * Quando false/ausente: mantém o comportamento atual de adquirir o advisory
   * lock em PoolClient próprio. Se não conseguir, retorna SKIPPED e libera
   * o lock no finally.
   */
  lockAlreadyAcquired?: boolean;
}

/**
 * Estado explícito da execução do snapshot (auditoria A7.4 Parte 2).
 * - PUBLISHED: snapshot completo, validado e publicado (COMMIT).
 * - LIMITED: coleta interrompida por maxRecordsPerSync (parcial, nada publicado).
 * - FAILED: falha de coleta, validação ou persistência (nada publicado).
 * - SKIPPED: bloqueio por lock (concorrência).
 */
export type SeiSnapshotExecutionState = 'PUBLISHED' | 'LIMITED' | 'FAILED' | 'SKIPPED';

/** Resultado estruturado de uma execução de snapshot. */
export interface SeiSnapshotResult {
  /** Se a operação completou sem erro (inclui snapshot parcial por limite). */
  success: boolean;
  /** Se o snapshot foi completo, validado e publicado. */
  complete: boolean;
  /** Se a coleta foi interrompida pelo maxRecordsPerSync (parcial, não completo). */
  limited: boolean;
  /** Se a execução foi bloqueada pelo advisory lock existente (concorrência). */
  skipped: boolean;
  /** Se a publicação atômica foi confirmada (COMMIT). */
  published: boolean;
  /** Total de registros brutos obtidos da API. */
  fetchedCount: number;
  /** Total de registros validados e incluídos no snapshot. */
  validatedCount: number;
  /** Total de registros persistidos/publicados (UPSERT). */
  publishedCount: number;
  /** Registros novos (não existiam em integration_snapshots). */
  insertedCount: number;
  /** Registros existentes cujos dados do snapshot mudaram. */
  updatedCount: number;
  /** Registros existentes com dados idênticos (apenas last_seen_at renovado). */
  unchangedCount: number;
  /** Registros presentes em snapshot anterior e AUSENTES do atual (marcados com absent_since). */
  missingCount: number;
  /** Registros que estavam marcados como ausentes e reapareceram (absent_since limpo). */
  reconciledCount: number;
  /** external_ids marcados como ausentes nesta execução (para auditoria). */
  missingIds: string[];
  /** Páginas processadas durante a coleta. */
  pagesProcessed: number;
  /** total_items declarado pela API (null se a coleta falhou antes do envelope). */
  totalItems: number | null;
  /** total_pages declarado pela API (null se a coleta falhou antes do envelope). */
  totalPages: number | null;
  /** Mensagem descritiva quando aplicável. */
  message?: string;
  /** Erro estruturado (quando success = false). */
  error?: string;
  /** Último status HTTP obtido (0 = erro de rede/baseUrl; null = sem HTTP). */
  httpStatus?: number | null;
  /** Se o erro foi de autenticação (401/403). */
  authError?: boolean;
  /** Estado explícito da execução (auditoria A7.4 Parte 2). */
  executionState: SeiSnapshotExecutionState;
  /** Duração total da operação em ms. */
  durationMs: number;
}

/** Estado da coleta paginada (antes da validação/publicação). */
interface CollectedSnapshot {
  items: unknown[];
  /** Contagem de ocorrências por NUP (detecção de duplicidade). */
  seen: Map<string, number>;
  /** Anomalias estruturais de paginação (ex.: página vazia antes de total_pages). */
  issues: string[];
  pagesProcessed: number;
  totalPages: number | null;
  totalItems: number | null;
  limited: boolean;
  fatalError?: string;
  httpStatus?: number | null;
  authError?: boolean;
}

/** Linha prévia de integration_snapshots usada na reconciliação. */
interface PriorSnapshotRow {
  external_id: string;
  proposal_number: string | null;
  external_status: string | null;
  raw_status: string | null;
  payload: unknown;
  absent_since: Date | string | null;
}

/** Resultado da publicação + reconciliação dentro da mesma transação. */
interface SnapshotPublishResult {
  publishedCount: number;
  insertedCount: number;
  updatedCount: number;
  unchangedCount: number;
  missingCount: number;
  reconciledCount: number;
  missingIds: string[];
}

/** Extrai a identidade determinística do registro = NUP. */
function extractProcessId(raw: unknown): string | undefined {
  return pickString(flattenPayload(raw), SEI_NUP_KEYS);
}

/**
 * Comparação profunda de valores JSON ignorando a ordem das chaves.
 * Usada para distinguir registros "atualizados" de "inalterados" (jsonb do
 * PostgreSQL não preserva a ordem de chaves do payload original).
 */
function deepJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => deepJsonEqual(value, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const recordA = a as Record<string, unknown>;
    const recordB = b as Record<string, unknown>;
    const keysA = Object.keys(recordA).sort();
    const keysB = Object.keys(recordB).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key, index) => key === keysB[index] && deepJsonEqual(recordA[key], recordB[key]));
  }
  return false;
}

/** Compara os dados persistidos de um registro com o que seria publicado agora. */
function sameSnapshotData(previous: PriorSnapshotRow, record: SeiSnapshotRecord): boolean {
  return (
    (previous.proposal_number ?? null) === (record.proposalNumber ?? null) &&
    (previous.external_status ?? null) === (record.externalStatus ?? null) &&
    (previous.raw_status ?? null) === (record.rawStatus ?? null) &&
    deepJsonEqual(previous.payload ?? null, record.payload ?? null)
  );
}

/**
 * Coleta todas as páginas em memória, sem nenhuma persistência.
 * Paginação: pagina a partir de 1, tamanho_da_pagina <= 200, até total_pages.
 * A interrupção por maxRecords marca o snapshot como limitado (parcial).
 */
async function collectSnapshot(
  adapter: GovernmentIntegrationAdapter,
  config: AdapterConfig,
  credential: string | null,
  maxRecords?: number,
): Promise<CollectedSnapshot> {
  const issues: string[] = [];
  const items: unknown[] = [];
  const seen = new Map<string, number>();
  let page = FIRST_PAGE;
  let totalPages: number | null = null;
  let totalItems: number | null = null;
  let pagesProcessed = 0;
  let limited = false;
  let fatalError: string | undefined;
  let httpStatus: number | null = null;
  let authError = false;

  const pageSize = maxRecords ? Math.min(maxRecords, MAX_PAGE_SIZE) : MAX_PAGE_SIZE;

  while (true) {
    const resp = await adapter.fetch(config, credential, {
      pagina: page,
      tamanho_da_pagina: pageSize,
    });

    if (resp.status === 0) {
      fatalError = config.baseUrl
        ? 'Falha de rede ou timeout ao consultar o SEI'
        : 'BaseUrl não configurada para o SEI';
      httpStatus = 0;
      break;
    }
    if (resp.status !== 200) {
      fatalError = `HTTP ${resp.status} na consulta ao SEI`;
      httpStatus = resp.status;
      authError = resp.status === 401 || resp.status === 403;
      break;
    }

    httpStatus = resp.status;

    const envelope = resp.data;

    let rawItems: unknown[];
    if (Array.isArray(envelope)) {
      // Contrato inferido — resposta de listagem sem envelope (array direto):
      // tratada como página única (total_pages = 1).
      if (page !== FIRST_PAGE) {
        fatalError = 'Resposta do SEI estruturalmente inválida: array direto após a primeira página';
        httpStatus = resp.status;
        break;
      }
      rawItems = envelope;
      totalPages = 1;
      totalItems = envelope.length;
    } else {
      if (
        !envelope ||
        typeof envelope !== 'object' ||
        !Array.isArray((envelope as Record<string, unknown>).data)
      ) {
        fatalError = 'Resposta do SEI estruturalmente inválida: envelope esperado com campo data (array)';
        httpStatus = resp.status;
        break;
      }

      const rec = envelope as Record<string, unknown>;
      rawItems = rec.data as unknown[];

      if (page === FIRST_PAGE) {
        if (
          !Number.isInteger(rec.total_pages) ||
          !Number.isInteger(rec.total_items) ||
          (rec.total_pages as number) < 1 ||
          (rec.total_items as number) < 0
        ) {
          fatalError = 'Resposta do SEI estruturalmente inválida: total_pages e total_items devem ser inteiros válidos';
          httpStatus = resp.status;
          break;
        }
        totalPages = rec.total_pages as number;
        totalItems = rec.total_items as number;
      }
    }

    for (const raw of rawItems) {
      items.push(raw);
      const nup = extractProcessId(raw);
      if (nup) {
        seen.set(nup, (seen.get(nup) ?? 0) + 1);
      }
    }
    pagesProcessed++;

    if (rawItems.length === 0) {
      if (totalPages !== null && page < totalPages) {
        issues.push(`página ${page} inesperadamente vazia antes de total_pages`);
      }
      break;
    }

    if (maxRecords && items.length >= maxRecords) {
      if (items.length > maxRecords) {
        items.splice(maxRecords);
      }
      limited = true;
      break;
    }

    if (totalPages !== null && page >= totalPages) {
      break;
    }
    page++;
  }

  return { items, seen, issues, pagesProcessed, totalPages, totalItems, limited, fatalError, httpStatus, authError };
}

/**
 * Constrói um registro de snapshot reutilizando a normalização do adapter.
 * A identidade (external_id) é sempre o NUP do payload bruto.
 */
function buildSnapshotRecord(
  raw: unknown,
  adapter: GovernmentIntegrationAdapter,
): { ok: true; record: SeiSnapshotRecord } | { ok: false; error: string } {
  const nup = extractProcessId(raw);
  if (!nup) {
    return { ok: false, error: 'NUP ausente ou vazio em registro do snapshot' };
  }
  if (!NUP_PATTERN.test(nup)) {
    return { ok: false, error: `Formato de NUP inválido em registro do snapshot: ${nup}` };
  }

  let normalized: NormalizedIntegrationEvent;
  try {
    normalized = adapter.normalize(raw);
  } catch (error) {
    return {
      ok: false,
      error: `Falha ao normalizar registro do snapshot: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const extra = normalized.extra ?? {};
  const rawStatus = typeof extra.rawStatus === 'string' ? extra.rawStatus : undefined;

  return {
    ok: true,
    record: {
      externalId: nup,
      proposalNumber: normalized.proposalNumber,
      externalStatus: normalized.externalStatus,
      rawStatus,
      payload: raw,
    },
  };
}

/**
 * Valida a completude e a integridade do snapshot coletado.
 * Qualquer inconsistência invalida o snapshot → nenhuma publicação.
 */
function validateSnapshot(
  collected: CollectedSnapshot,
  adapter: GovernmentIntegrationAdapter,
): { valid: true; records: SeiSnapshotRecord[] } | { valid: false; error: string } {
  if (collected.fatalError) {
    return { valid: false, error: collected.fatalError };
  }

  if (collected.issues.length > 0) {
    return { valid: false, error: collected.issues[0] };
  }

  const duplicates = [...collected.seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicates.length > 0) {
    return { valid: false, error: `Duplicatas de NUP no snapshot: ${duplicates.join(', ')}` };
  }

  if (collected.totalItems !== collected.items.length) {
    return {
      valid: false,
      error: `Incoerência de contagem: total_items=${collected.totalItems} mas registros obtidos=${collected.items.length}`,
    };
  }
  if (collected.totalPages !== collected.pagesProcessed) {
    return {
      valid: false,
      error: `Incoerência de paginação: total_pages=${collected.totalPages} mas páginas processadas=${collected.pagesProcessed}`,
    };
  }

  const records: SeiSnapshotRecord[] = [];
  for (const raw of collected.items) {
    // Itens sem NUP são ignorados (não invalidam o snapshot) — contrato inferido.
    if (!extractProcessId(raw)) continue;
    const built = buildSnapshotRecord(raw, adapter);
    if (!built.ok) {
      return { valid: false, error: built.error };
    }
    records.push(built.record);
  }

  return { valid: true, records };
}

/**
 * Publica o snapshot e reconcilia ausentes de forma atômica:
 * BEGIN → leitura do estado prévio → UPSERTs → marcação de ausentes → COMMIT.
 * Qualquer erro dispara ROLLBACK (via transaction) e o estado anterior permanece válido.
 *
 * @param currentIds Identidade (external_id) de todos os registros do snapshot atual.
 *                   Usada para detectar, em O(n), quais registros prévios desapareceram.
 *                   A ausência NUNCA gera DELETE físico — apenas absent_since = NOW().
 */
async function publishSnapshot(
  systemId: number,
  records: SeiSnapshotRecord[],
  currentIds: Set<string>,
): Promise<SnapshotPublishResult> {
  return transaction(async (client) => {
    const prior = await client.query<PriorSnapshotRow>(
      `SELECT external_id, proposal_number, external_status, raw_status, payload, absent_since
       FROM integration_snapshots
       WHERE system_id = $1`,
      [systemId],
    );
    const priorById = new Map<string, PriorSnapshotRow>();
    for (const row of prior.rows) {
      priorById.set(row.external_id, row);
    }

    let published = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let reconciled = 0;

    for (const record of records) {
      const previous = priorById.get(record.externalId);
      if (previous) {
        const wasAbsent = previous.absent_since !== null;
        if (sameSnapshotData(previous, record)) unchanged++;
        else updated++;
        if (wasAbsent) reconciled++;
      } else {
        inserted++;
      }

      await client.query(
        `INSERT INTO integration_snapshots
           (system_id, external_id, proposal_number, external_status, raw_status, payload, last_seen_at, absent_since, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, NOW())
         ON CONFLICT (system_id, external_id) DO UPDATE SET
           proposal_number = EXCLUDED.proposal_number,
           external_status = EXCLUDED.external_status,
           raw_status = EXCLUDED.raw_status,
           payload = EXCLUDED.payload,
           last_seen_at = NOW(),
           absent_since = NULL,
           updated_at = NOW()`,
        [
          systemId,
          record.externalId,
          record.proposalNumber ?? null,
          record.externalStatus ?? null,
          record.rawStatus ?? null,
          JSON.stringify(record.payload),
        ],
      );
      published++;
    }

    // Reconciliação de ausentes — uma única instrução set-based (sem O(n²)):
    // registros com absent_since IS NULL que NÃO estão no snapshot atual viram
    // absent_since = NOW(). Nenhum registro é apagado fisicamente.
    const missingResult = await client.query<{ external_id: string }>(
      `UPDATE integration_snapshots
       SET absent_since = NOW(), updated_at = NOW()
       WHERE system_id = $1
         AND absent_since IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM unnest($2::text[]) AS current(eid)
           WHERE current.eid = integration_snapshots.external_id
         )
       RETURNING external_id`,
      [systemId, [...currentIds]],
    );
    const missingIds = missingResult.rows.map((row) => row.external_id);
    const missingCount = missingResult.rowCount ?? 0;

    return {
      publishedCount: published,
      insertedCount: inserted,
      updatedCount: updated,
      unchangedCount: unchanged,
      missingCount,
      reconciledCount: reconciled,
      missingIds,
    };
  });
}

function baseResult(): SeiSnapshotResult {
  return {
    success: false,
    complete: false,
    limited: false,
    skipped: false,
    published: false,
    fetchedCount: 0,
    validatedCount: 0,
    publishedCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    missingCount: 0,
    reconciledCount: 0,
    missingIds: [],
    pagesProcessed: 0,
    totalItems: null,
    totalPages: null,
    httpStatus: null,
    authError: false,
    executionState: 'FAILED',
    durationMs: 0,
  };
}

/* ------------------------------------------------------------------ */
/* A7.4 Parte 2 — auditoria em integration_logs                       */
/* ------------------------------------------------------------------ */

/** Ação usada nos registros de auditoria do snapshot em integration_logs. */
const SNAPSHOT_LOG_ACTION = 'integration.snapshot.sei';
/** Origem (trigger) dos registros de auditoria do snapshot. */
const SNAPSHOT_LOG_TRIGGER = 'snapshot-sync';

/** Mapeia o estado explícito da execução para o status de integration_logs. */
function mapExecutionStateToLogStatus(state: SeiSnapshotExecutionState): 'success' | 'warning' | 'error' {
  if (state === 'PUBLISHED' || state === 'SKIPPED') return 'success';
  if (state === 'LIMITED') return 'warning';
  return 'error';
}

/** Mensagem human-readable para o log de auditoria. */
function buildSnapshotLogMessage(result: SeiSnapshotResult): string {
  if (result.message) return result.message;
  if (result.error) return `Snapshot do SEI falhou: ${result.error}`;
  return 'Execução do snapshot do SEI concluída';
}

/** Métricas essenciais da execução (JSONB, sem segredos). */
function buildSnapshotMetrics(result: SeiSnapshotResult): Record<string, unknown> {
  return {
    api_contract: 'inferred',
    execution_state: result.executionState,
    complete: result.complete,
    limited: result.limited,
    skipped: result.skipped,
    published: result.published,
    fetched_count: result.fetchedCount,
    validated_count: result.validatedCount,
    published_count: result.publishedCount,
    inserted_count: result.insertedCount,
    updated_count: result.updatedCount,
    unchanged_count: result.unchangedCount,
    missing_count: result.missingCount,
    reconciled_count: result.reconciledCount,
    pages_processed: result.pagesProcessed,
    total_items: result.totalItems,
    total_pages: result.totalPages,
  };
}

/**
 * Registra a auditoria da execução em integration_logs (fora da transação de
 * publicação, para que um ROLLBACK nunca apague a evidência da tentativa).
 * Best-effort: uma falha de escrita NUNCA quebra a sincronização.
 */
async function recordSnapshotExecutionLog(
  system: { id: number; code: string },
  result: SeiSnapshotResult,
): Promise<void> {
  try {
    await run(
      `INSERT INTO integration_logs
         (system_id, system_code, direction, action, status, message, duration_ms, http_status, triggered_by, execution_state, metrics, error_message)
       VALUES ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        system.id,
        system.code,
        SNAPSHOT_LOG_ACTION,
        mapExecutionStateToLogStatus(result.executionState),
        buildSnapshotLogMessage(result),
        result.durationMs,
        result.httpStatus ?? null,
        SNAPSHOT_LOG_TRIGGER,
        result.executionState,
        JSON.stringify(buildSnapshotMetrics(result)),
        result.error ?? null,
      ],
    );
  } catch (error) {
    logger.warn('SEI: falha ao registrar auditoria da execução do snapshot', {
      system: system.code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Executa o snapshot do SEI de ponta a ponta:
 * lock → coleta → validação → cálculo da reconciliação →
 * publicação atômica (BEGIN → persistência → reconciliação → COMMIT) ou ROLLBACK,
 * com auditoria em integration_logs após cada execução real.
 *
 * A reconciliação de ausentes só ocorre para snapshot COMPLETO e validado e
 * acontece dentro da mesma transação da publicação (tudo ou nada). Execuções
 * limitadas por maxRecordsPerSync, com erro de coleta ou erro de validação
 * NÃO reconciliam ausentes.
 *
 * @param system Sistema de integração (id + code).
 * @param config Configuração carregada de integration_systems.config + env.
 * @param params Parâmetros opcionais (maxRecords/maxRecordsPerSync).
 */
export async function runSeiSnapshotSync(
  system: { id: number; code: string },
  config: AdapterConfig,
  params: SeiSnapshotParams = {},
): Promise<SeiSnapshotResult> {
  const startedAt = Date.now();
  const result = baseResult();

  const maxRecords =
    typeof params.maxRecords === 'number' && params.maxRecords > 0 ? Math.floor(params.maxRecords) : undefined;

  const lockAlreadyAcquired = params.lockAlreadyAcquired === true;

  let lockClient: PoolClient | null = null;
  let lockAcquired = false;
  try {
    if (!lockAlreadyAcquired) {
      lockClient = await pool.connect();
      const lockQuery = await lockClient.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock',
        [SYNC_LOCK_KEY],
      );
      lockAcquired = lockQuery.rows[0].pg_try_advisory_lock;
      if (!lockAcquired) {
        result.skipped = true;
        result.executionState = 'SKIPPED';
        result.error = 'Sincronização bloqueada: outra execução está em andamento (advisory lock do ciclo)';
        result.durationMs = Date.now() - startedAt;
        return result;
      }
    } else {
      lockAcquired = true;
    }

    const adapter = getGovAdapter(system.code);
    if (!adapter) {
      result.executionState = 'FAILED';
      result.error = `Nenhum adapter governamental registrado para o sistema ${system.code}`;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

    const credential = await adapter.authenticate(config);

    const collected = await collectSnapshot(adapter, config, credential, maxRecords);

    result.fetchedCount = collected.items.length;
    result.pagesProcessed = collected.pagesProcessed;
    result.totalItems = collected.totalItems;
    result.totalPages = collected.totalPages;
    result.httpStatus = collected.httpStatus ?? null;
    result.authError = collected.authError ?? false;

    if (collected.fatalError) {
      result.executionState = 'FAILED';
      result.error = collected.fatalError;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

    if (collected.limited) {
      result.executionState = 'LIMITED';
      result.success = true;
      result.complete = false;
      result.limited = true;
      result.message = `Coleta interrompida no limite de ${maxRecords} registros: snapshot parcial, não publicado como completo`;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

    const validation = validateSnapshot(collected, adapter);
    if (!validation.valid) {
      result.executionState = 'FAILED';
      result.error = validation.error;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

    result.validatedCount = validation.records.length;

    // A7.4 — cálculo da reconciliação (antes do BEGIN): identidade do snapshot
    // atual por (system_id + external_id). A publicação e a reconciliação de
    // ausentes acontecem dentro da MESMA transação.
    const currentIds = new Set(validation.records.map((record) => record.externalId));

    const publish = await publishSnapshot(system.id, validation.records, currentIds);

    result.executionState = 'PUBLISHED';
    result.success = true;
    result.complete = true;
    result.published = true;
    result.publishedCount = publish.publishedCount;
    result.insertedCount = publish.insertedCount;
    result.updatedCount = publish.updatedCount;
    result.unchangedCount = publish.unchangedCount;
    result.missingCount = publish.missingCount;
    result.reconciledCount = publish.reconciledCount;
    result.missingIds = publish.missingIds;
    const reconciliation = publish.missingCount > 0
      ? `, ${publish.missingCount} ausente${publish.missingCount === 1 ? '' : 's'} reconciliado${publish.missingCount === 1 ? '' : 's'} (sem exclusão física)`
      : ', nenhum ausente';
    result.message = `Snapshot completo publicado: ${publish.publishedCount} registros (${collected.items.length} obtidos em ${collected.pagesProcessed} páginas${reconciliation})`;
    result.durationMs = Date.now() - startedAt;
    await recordSnapshotExecutionLog(system, result);
    return result;
  } catch (error) {
    result.executionState = 'FAILED';
    result.error = `Falha na sincronização de snapshot: ${error instanceof Error ? error.message : String(error)}`;
    result.durationMs = Date.now() - startedAt;
    await recordSnapshotExecutionLog(system, result);
    return result;
  } finally {
    if (lockAcquired && !lockAlreadyAcquired) {
      try {
        await lockClient?.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
      } catch {
        // liberação do lock é best-effort
      }
    }
    if (!lockAlreadyAcquired) {
      lockClient?.release();
    }
  }
}
