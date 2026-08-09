/**
 * Fase F2.2 — Paginação Institucional.
 *
 * Helper compartilhado para padronizar consultas paginadas em todas as rotas
 * de listagem do SGD:
 *
 *   GET /api/demands?page=1&limit=100
 *   GET /api/audit?page=1&limit=100
 *   GET /api/integrations/admin/logs?page=1&limit=100
 *   GET /api/admin/outbound-webhooks/deliveries?page=1&limit=100
 *
 * Garantias:
 * - page  → mínimo 1;
 * - limit → padrão 100, máximo 500 (evita retornos excessivos);
 * - valores inválidos caem no padrão (nunca NaN/infinito);
 * - resposta padronizada: { page, limit, offset, total, totalPages }.
 *
 * Compatibilidade: rotas que não informavam paginação continuam funcionando
 * (limit padrão), e os formatos de resposta anteriores (data + pagination)
 * são preservados pelas rotas que chamam o helper.
 */

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

export interface PaginationQuery {
  page?: unknown;
  limit?: unknown;
}

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
}

function toPositiveInt(value: unknown, fallback: number, max?: number): number {
  const n = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  const floor = Math.floor(n);
  return max ? Math.min(floor, max) : floor;
}

/**
 * Normaliza page/limit/offset a partir de query string.
 * Padrão: page=1, limit=100. Máximo de limit: 500.
 */
export function parsePagination(query: PaginationQuery, overrides: { page?: number; limit?: number } = {}): PaginationParams {
  const page = toPositiveInt(query.page, overrides.page ?? 1);
  const limit = toPositiveInt(query.limit, overrides.limit ?? DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * Monta o objeto de paginação a partir de total e parâmetros já normalizados.
 */
export function buildPaginationMeta(total: number, params: PaginationParams): PaginationMeta {
  const safeTotal = Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0;
  return {
    page: params.page,
    limit: params.limit,
    offset: params.offset,
    total: safeTotal,
    totalPages: params.limit > 0 ? Math.ceil(safeTotal / params.limit) : 0,
  };
}

/**
 * Conveniência: normaliza page/limit/offset e já monta o objeto de resposta
 * com total. Usado pelas rotas que precisam de ambos num passo só.
 */
export function paginate(total: number, query: PaginationQuery, overrides: { page?: number; limit?: number } = {}): PaginationMeta {
  const params = parsePagination(query, overrides);
  return buildPaginationMeta(total, params);
}
