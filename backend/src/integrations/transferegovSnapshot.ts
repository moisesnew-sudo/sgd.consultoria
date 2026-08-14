/**
 * Motor de snapshot do Transferegov (A7.3 + A7.4).
 *
 * Arquitetura: coleta completa em memória → validação do snapshot →
 * cálculo da reconciliação → publicação atômica (BEGIN → persistência →
 * reconciliação → COMMIT) com ROLLBACK em erro.
 * Nenhuma transação de banco fica aberta durante chamadas HTTP.
 *
 * Identidade dos registros: external_id = cd_parceria (obrigatório, não vazio,
 * único e determinístico). O campo nu_externo NÃO é usado como chave de lookup.
 * A comparação entre snapshots usa (system_id + external_id), nunca nome,
 * proposta, descrição, status ou posição na paginação.
 *
 * Concorrência: reutiliza o advisory lock existente do ciclo de sincronização
 * (SYNC_LOCK_KEY de integrationScheduler) — nenhum novo mecanismo de lock é criado.
 *
 * A7.4 — Reconciliação segura (reversível e auditável):
 *  - Registros presentes no snapshot atual são UPSERT (sem apagar nada);
 *  - Registros presentes em snapshot anterior mas AUSENTES do snapshot atual
 *    recebem absent_since = NOW() — NUNCA são apagados fisicamente;
 *  - A reconciliação de ausentes só acontece para snapshot COMPLETO e validado,
 *    dentro da mesma transação da publicação (tudo ou nada);
 *  - Execuções limitadas (maxRecordsPerSync) ou com erro não reconciliam ausentes.
 *
 * A7.4 Parte 2 — Auditoria e data de atualização da base:
 *  - Cada execução registra um estado explícito (PUBLISHED | LIMITED | FAILED |
 *    SKIPPED) em integration_logs com métricas essenciais (JSONB, sem segredos);
 *  - O registro de auditoria é escrito FORA da transação de publicação — um
 *    ROLLBACK nunca apaga a evidência da tentativa;
 *  - O endpoint oficial GET /parcerias/data-atualizacao é consultado sempre:
 *    se retornar data válida e igual à última armazenada → SKIPPED (auditado);
 *    se falhar ou retornar data inválida → fallback de snapshot completo (falha
 *    NUNCA é tratada como "sem alterações") e o valor armazenado não é atualizado;
 *  - A data de atualização só é persistida na MESMA transação de um snapshot
 *    completo e validado (COMMIT confirma ambos, ROLLBACK desfaz ambos).
 */
import type { PoolClient } from 'pg';
import { pool, run, get, transaction } from '../database.js';
import { getGovAdapter } from '../lib/adapterRegistry.js';
import { logger } from '../lib/logger.js';
import { SYNC_LOCK_KEY } from '../lib/integrationScheduler.js';
import { fetchTransferegovDataAtualizacao } from './transferegov.adapter.js';
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
/** Chaves do identificador de parceria no contrato real da API (cd_parceria). */
const CD_PARCERIA_KEYS = ['cd_parceria'];

/** Registro de snapshot persistido/publicado. */
export interface TransferegovSnapshotRecord {
  /** Identidade determinística do registro = cd_parceria. */
  externalId: string;
  /** Número da proposta (id_proposta) quando presente. */
  proposalNumber?: string;
  /** Status externo normalizado (CAIXA ALTA, sem acentos). */
  externalStatus?: string;
  /** Status externo original (como retornado pela API). */
  rawStatus?: string;
  /** Valor original de vl_total_planejamento_gastos (sem conversão de tipo). */
  financialValue?: unknown;
  /** Payload original do item, preservado para auditoria. */
  payload: unknown;
}

/** Parâmetros da execução de snapshot. */
export interface TransferegovSnapshotParams {
  /** Limite máximo de registros por execução (maxRecordsPerSync). Quando atingido, a coleta é interrompida e o resultado é parcial (não publicado como completo). */
  maxRecords?: number;
}

/**
 * Estado explícito da execução do snapshot (auditoria A7.4 Parte 2).
 * - PUBLISHED: snapshot completo, validado e publicado (COMMIT).
 * - LIMITED: coleta interrompida por maxRecordsPerSync (parcial, nada publicado).
 * - FAILED: falha de coleta, validação ou persistência (nada publicado).
 * - SKIPPED: base sem alterações (data-atualizacao igual) ou bloqueio por lock.
 */
export type TransferegovSnapshotExecutionState = 'PUBLISHED' | 'LIMITED' | 'FAILED' | 'SKIPPED';

/** Metadados da consulta de data de atualização da base oficial (auditoria). */
export interface TransferegovDataAtualizacaoMeta {
  /** Se a consulta ao endpoint foi tentada. */
  checked: boolean;
  /** Se o endpoint retornou data de atualização válida. */
  available: boolean;
  /** Valor válido obtido do endpoint (ex.: YYYY-MM-DD). */
  value?: string;
  /** Se o valor obtido é igual ao último armazenado (base sem alterações). */
  matched?: boolean;
  /** Motivo de indisponibilidade (falha de rede/HTTP/formato inválido). */
  error?: string;
  /** Status HTTP do endpoint de data de atualização (0 = rede; null = sem HTTP). */
  httpStatus?: number | null;
}

/** Resultado estruturado de uma execução de snapshot. */
export interface TransferegovSnapshotResult {
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
  /** external_ids marcados como ausentes nesta execução (para auditoria/Parte 2). */
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
  executionState: TransferegovSnapshotExecutionState;
  /** Data de atualização da base oficial obtida e validada (quando disponível). */
  dataAtualizacao?: string;
  /** Metadados da consulta de data de atualização (auditoria). */
  dataAtualizacaoMeta?: TransferegovDataAtualizacaoMeta;
  /** Duração total da operação em ms. */
  durationMs: number;
}

/** Estado da coleta paginada (antes da validação/publicação). */
interface CollectedSnapshot {
  items: unknown[];
  /** Contagem de ocorrências por cd_parceria (detecção de duplicidade). */
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
  vl_total_planejamento_gastos: string | number | null;
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

/** Opções da publicação atômica do snapshot. */
interface SnapshotPublishOptions {
  /** Última data de atualização da base oficial (persistida na MESMA transação da publicação). */
  dataAtualizacao?: string;
}

/** Extrai a identidade determinística do registro = cd_parceria. */
function extractPartnershipId(raw: unknown): string | undefined {
  return pickString(flattenPayload(raw), CD_PARCERIA_KEYS);
}

/** Converte o valor financeiro original em NUMERIC (ou null se não numérico). */
function toNumericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return null;
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
function sameSnapshotData(previous: PriorSnapshotRow, record: TransferegovSnapshotRecord): boolean {
  const previousValue =
    previous.vl_total_planejamento_gastos === null ? null : Number(previous.vl_total_planejamento_gastos);
  const nextValue = toNumericOrNull(record.financialValue);
  return (
    (previous.proposal_number ?? null) === (record.proposalNumber ?? null) &&
    (previous.external_status ?? null) === (record.externalStatus ?? null) &&
    (previous.raw_status ?? null) === (record.rawStatus ?? null) &&
    previousValue === nextValue &&
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
        ? 'Falha de rede ou timeout ao consultar o Transferegov'
        : 'BaseUrl não configurada para o Transferegov';
      httpStatus = 0;
      break;
    }
    if (resp.status !== 200) {
      fatalError = `HTTP ${resp.status} na consulta ao Transferegov`;
      httpStatus = resp.status;
      authError = resp.status === 401 || resp.status === 403;
      break;
    }

    httpStatus = resp.status;

    const envelope = resp.data;
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      !Array.isArray((envelope as Record<string, unknown>).data)
    ) {
      fatalError = 'Resposta do Transferegov estruturalmente inválida: envelope esperado com campo data (array)';
      httpStatus = resp.status;
      break;
    }

    const rec = envelope as Record<string, unknown>;
    const data = rec.data as unknown[];

    if (page === FIRST_PAGE) {
      if (
        !Number.isInteger(rec.total_pages) ||
        !Number.isInteger(rec.total_items) ||
        (rec.total_pages as number) < 1 ||
        (rec.total_items as number) < 0
      ) {
        fatalError = 'Resposta do Transferegov estruturalmente inválida: total_pages e total_items devem ser inteiros válidos';
        httpStatus = resp.status;
        break;
      }
      totalPages = rec.total_pages as number;
      totalItems = rec.total_items as number;
    }

    for (const raw of data) {
      items.push(raw);
      const cdParceria = extractPartnershipId(raw);
      if (!cdParceria) {
        issues.push('cd_parceria ausente ou vazio');
      } else {
        seen.set(cdParceria, (seen.get(cdParceria) ?? 0) + 1);
      }
    }
    pagesProcessed++;

    if (data.length === 0) {
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
 * A identidade (external_id) é sempre o cd_parceria do payload bruto.
 */
function buildSnapshotRecord(
  raw: unknown,
  adapter: GovernmentIntegrationAdapter,
): { ok: true; record: TransferegovSnapshotRecord } | { ok: false; error: string } {
  const cdParceria = extractPartnershipId(raw);
  if (!cdParceria) {
    return { ok: false, error: 'cd_parceria ausente ou vazio em registro do snapshot' };
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
  const financialValue = extra.vlTotalPlanejamentoGastos;

  return {
    ok: true,
    record: {
      externalId: cdParceria,
      proposalNumber: normalized.proposalNumber,
      externalStatus: normalized.externalStatus,
      rawStatus,
      financialValue,
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
): { valid: true; records: TransferegovSnapshotRecord[] } | { valid: false; error: string } {
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
    return { valid: false, error: `cd_parceria duplicado no snapshot: ${duplicates.join(', ')}` };
  }

  const missing = collected.items.filter((raw) => !extractPartnershipId(raw));
  if (missing.length > 0) {
    return { valid: false, error: 'cd_parceria ausente ou vazio em registro do snapshot' };
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

  const records: TransferegovSnapshotRecord[] = [];
  for (const raw of collected.items) {
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
  records: TransferegovSnapshotRecord[],
  currentIds: Set<string>,
  options: SnapshotPublishOptions = {},
): Promise<SnapshotPublishResult> {
  return transaction(async (client) => {
    const prior = await client.query<PriorSnapshotRow>(
      `SELECT external_id, proposal_number, external_status, raw_status,
              vl_total_planejamento_gastos, payload, absent_since
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
           (system_id, external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, payload, last_seen_at, absent_since, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL, NOW())
         ON CONFLICT (system_id, external_id) DO UPDATE SET
           proposal_number = EXCLUDED.proposal_number,
           external_status = EXCLUDED.external_status,
           raw_status = EXCLUDED.raw_status,
           vl_total_planejamento_gastos = EXCLUDED.vl_total_planejamento_gastos,
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
          toNumericOrNull(record.financialValue),
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

    // A7.4 Parte 2 — persiste a data de atualização da base oficial junto com o
    // snapshot na MESMA transação: o COMMIT confirma ambos e o ROLLBACK desfaz
    // ambos. O valor só chega aqui quando a consulta data-atualizacao foi válida.
    if (options.dataAtualizacao) {
      await client.query(
        `UPDATE integration_systems
         SET last_data_atualizacao = $2, updated_at = NOW()
         WHERE id = $1`,
        [systemId, options.dataAtualizacao],
      );
    }

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

function baseResult(): TransferegovSnapshotResult {
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
/* A7.4 Parte 2 — data-atualizacao e auditoria em integration_logs    */
/* ------------------------------------------------------------------ */

/** Ação usada nos registros de auditoria do snapshot em integration_logs. */
const SNAPSHOT_LOG_ACTION = 'integration.snapshot.transferegov';
/** Origem (trigger) dos registros de auditoria do snapshot. */
const SNAPSHOT_LOG_TRIGGER = 'snapshot-sync';

/** Última data de atualização armazenada para o sistema (integration_systems). */
async function getLastDataAtualizacao(systemId: number): Promise<string | null> {
  const row = await get<{ last_data_atualizacao: string | null }>(
    'SELECT last_data_atualizacao FROM integration_systems WHERE id = $1',
    [systemId],
  );
  return row?.last_data_atualizacao ?? null;
}

/** Valida se o valor informado é uma data interpretável. */
function isValidDataAtualizacao(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

/**
 * Consulta a data de atualização da base oficial e compara com a última
 * armazenada. Nunca lança exceção: falhas de rede/HTTP/formato retornam
 * available=false (o chamador usa o fallback de snapshot completo e NUNCA
 * trata indisponibilidade como "base sem alterações").
 */
async function checkDataAtualizacao(
  systemId: number,
  config: AdapterConfig,
  credential: string | null,
): Promise<TransferegovDataAtualizacaoMeta> {
  try {
    const last = await getLastDataAtualizacao(systemId);
    const fetched = await fetchTransferegovDataAtualizacao(config, credential);
    if (!fetched.ok) {
      return { checked: true, available: false, error: fetched.error, httpStatus: fetched.httpStatus };
    }
    const value = fetched.value as string;
    if (!isValidDataAtualizacao(value)) {
      return {
        checked: true,
        available: false,
        error: `Data de atualização inválida retornada pela API: ${value}`,
        httpStatus: fetched.httpStatus,
      };
    }
    return {
      checked: true,
      available: true,
      value,
      matched: last !== null && last === value,
      httpStatus: fetched.httpStatus,
    };
  } catch (error) {
    return {
      checked: true,
      available: false,
      error: error instanceof Error ? error.message : String(error),
      httpStatus: null,
    };
  }
}

/** Mapeia o estado explícito da execução para o status de integration_logs. */
function mapExecutionStateToLogStatus(state: TransferegovSnapshotExecutionState): 'success' | 'warning' | 'error' {
  if (state === 'PUBLISHED' || state === 'SKIPPED') return 'success';
  if (state === 'LIMITED') return 'warning';
  return 'error';
}

/** Mensagem human-readable para o log de auditoria. */
function buildSnapshotLogMessage(result: TransferegovSnapshotResult): string {
  if (result.message) return result.message;
  if (result.error) return `Snapshot do Transferegov falhou: ${result.error}`;
  return 'Execução do snapshot do Transferegov concluída';
}

/** Métricas essenciais da execução (JSONB, sem segredos). */
function buildSnapshotMetrics(result: TransferegovSnapshotResult): Record<string, unknown> {
  return {
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
    ...(result.dataAtualizacaoMeta
      ? { data_atualizacao: { ...result.dataAtualizacaoMeta, value: result.dataAtualizacaoMeta.value ?? null } }
      : {}),
  };
}

/**
 * Registra a auditoria da execução em integration_logs (fora da transação de
 * publicação, para que um ROLLBACK nunca apague a evidência da tentativa).
 * Best-effort: uma falha de escrita NUNCA quebra a sincronização.
 */
async function recordSnapshotExecutionLog(
  system: { id: number; code: string },
  result: TransferegovSnapshotResult,
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
    logger.warn('Transferegov: falha ao registrar auditoria da execução do snapshot', {
      system: system.code,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Executa o snapshot do Transferegov de ponta a ponta:
 * lock → data-atualizacao → coleta → validação → cálculo da reconciliação →
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
export async function runTransferegovSnapshotSync(
  system: { id: number; code: string },
  config: AdapterConfig,
  params: TransferegovSnapshotParams = {},
): Promise<TransferegovSnapshotResult> {
  const startedAt = Date.now();
  const result = baseResult();

  const maxRecords =
    typeof params.maxRecords === 'number' && params.maxRecords > 0 ? Math.floor(params.maxRecords) : undefined;

  let lockClient: PoolClient | null = null;
  let lockAcquired = false;
  try {
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

    const adapter = getGovAdapter(system.code);
    if (!adapter) {
      result.executionState = 'FAILED';
      result.error = `Nenhum adapter governamental registrado para o sistema ${system.code}`;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

    const credential = await adapter.authenticate(config);

    // A7.4 Parte 2 — data-atualizacao (sempre consultado, com fallback seguro):
    // se a base oficial informar data de atualização válida e IGUAL à última
    // armazenada, o snapshot já está atualizado → SKIPPED (auditado). Falha ou
    // formato inválido NUNCA são tratados como "sem alterações": caem no
    // fallback de snapshot completo, sem atualizar o valor armazenado.
    const dataAtualizacaoMeta = await checkDataAtualizacao(system.id, config, credential);
    result.dataAtualizacaoMeta = dataAtualizacaoMeta;
    if (dataAtualizacaoMeta.available && dataAtualizacaoMeta.matched) {
      result.skipped = true;
      result.executionState = 'SKIPPED';
      result.success = true;
      result.complete = true;
      result.dataAtualizacao = dataAtualizacaoMeta.value;
      result.httpStatus = dataAtualizacaoMeta.httpStatus ?? null;
      result.message = `Base do Transferegov sem alterações desde ${dataAtualizacaoMeta.value}: snapshot já atualizado`;
      result.durationMs = Date.now() - startedAt;
      await recordSnapshotExecutionLog(system, result);
      return result;
    }

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

    const publish = await publishSnapshot(system.id, validation.records, currentIds, {
      dataAtualizacao: dataAtualizacaoMeta.available ? dataAtualizacaoMeta.value : undefined,
    });

    result.executionState = 'PUBLISHED';
    result.success = true;
    result.complete = true;
    result.published = true;
    if (dataAtualizacaoMeta.available) {
      result.dataAtualizacao = dataAtualizacaoMeta.value;
    }
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
    if (lockAcquired) {
      try {
        await lockClient?.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]);
      } catch {
        // liberação do lock é best-effort
      }
    }
    lockClient?.release();
  }
}
