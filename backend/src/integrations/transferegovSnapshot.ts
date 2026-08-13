/**
 * Motor de snapshot do Transferegov (A7.3).
 *
 * Arquitetura: coleta completa em memória → validação do snapshot →
 * publicação atômica (BEGIN → persistência → COMMIT) com ROLLBACK em erro.
 * Nenhuma transação de banco fica aberta durante chamadas HTTP.
 *
 * Identidade dos registros: external_id = cd_parceria (obrigatório, não vazio,
 * único e determinístico). O campo nu_externo NÃO é usado como chave de lookup.
 *
 * Concorrência: reutiliza o advisory lock existente do ciclo de sincronização
 * (SYNC_LOCK_KEY de integrationScheduler) — nenhum novo mecanismo de lock é criado.
 *
 * Registros ausentes na API NÃO são removidos neste lote (planejado para A7.4).
 */
import type { PoolClient } from 'pg';
import { pool, transaction } from '../database.js';
import { getGovAdapter } from '../lib/adapterRegistry.js';
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
  /** Total de registros persistidos/publicados. */
  publishedCount: number;
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
 * Publica o snapshot de forma atômica: BEGIN → upserts → COMMIT.
 * Qualquer erro dispara ROLLBACK (via transaction) e o estado anterior permanece válido.
 */
async function publishSnapshot(systemId: number, records: TransferegovSnapshotRecord[]): Promise<number> {
  return transaction(async (client) => {
    let published = 0;
    for (const record of records) {
      await client.query(
        `INSERT INTO integration_snapshots
           (system_id, external_id, proposal_number, external_status, raw_status, vl_total_planejamento_gastos, payload, last_seen_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (system_id, external_id) DO UPDATE SET
           proposal_number = EXCLUDED.proposal_number,
           external_status = EXCLUDED.external_status,
           raw_status = EXCLUDED.raw_status,
           vl_total_planejamento_gastos = EXCLUDED.vl_total_planejamento_gastos,
           payload = EXCLUDED.payload,
           last_seen_at = NOW(),
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
    return published;
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
    pagesProcessed: 0,
    totalItems: null,
    totalPages: null,
    httpStatus: null,
    authError: false,
    durationMs: 0,
  };
}

/**
 * Executa o snapshot do Transferegov de ponta a ponta:
 * lock → coleta → validação → publicação atômica (ou ROLLBACK).
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
      result.error = 'Sincronização bloqueada: outra execução está em andamento (advisory lock do ciclo)';
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    const adapter = getGovAdapter(system.code);
    if (!adapter) {
      result.error = `Nenhum adapter governamental registrado para o sistema ${system.code}`;
      result.durationMs = Date.now() - startedAt;
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
      result.error = collected.fatalError;
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    if (collected.limited) {
      result.success = true;
      result.complete = false;
      result.limited = true;
      result.message = `Coleta interrompida no limite de ${maxRecords} registros: snapshot parcial, não publicado como completo`;
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    const validation = validateSnapshot(collected, adapter);
    if (!validation.valid) {
      result.error = validation.error;
      result.durationMs = Date.now() - startedAt;
      return result;
    }

    result.validatedCount = validation.records.length;

    const publishedCount = await publishSnapshot(system.id, validation.records);

    result.success = true;
    result.complete = true;
    result.published = true;
    result.publishedCount = publishedCount;
    result.message = `Snapshot completo publicado: ${publishedCount} registros (${collected.items.length} obtidos em ${collected.pagesProcessed} páginas)`;
    result.durationMs = Date.now() - startedAt;
    return result;
  } catch (error) {
    result.error = `Falha na sincronização de snapshot: ${error instanceof Error ? error.message : String(error)}`;
    result.durationMs = Date.now() - startedAt;
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
