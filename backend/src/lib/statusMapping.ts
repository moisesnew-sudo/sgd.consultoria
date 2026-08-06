import { get } from '../database.js';
import { logger } from './logger.js';

export interface StatusMappingResult {
  internalStatus: string | null;
  found: boolean;
}

/**
 * Mapeia um status recebido de um sistema externo (Transferegov, SEI, CGLOG)
 * para o status interno do SGD, usando a tabela configurável integration_status_mapping.
 * - Busca somente regras ativas de sistemas ativos;
 * - External status normalizado em CAIXA ALTA (padrão dos seeds);
 * - Quando o sistema existe mas o status é desconhecido, registra warning e retorna found=false;
 * - Nunca altera demanda — preparação para uso pelo integrationSync (Fase 2).
 */
export async function getMappedStatus(systemCode: string, externalStatus: string): Promise<StatusMappingResult> {
  const code = String(systemCode || '').toLowerCase().trim();
  const status = String(externalStatus || '').trim().toUpperCase();

  if (!code || !status) {
    return { internalStatus: null, found: false };
  }

  const row = await get<{ internal_status: string }>(
    `SELECT m.internal_status
     FROM integration_status_mapping m
     JOIN integration_systems s ON s.id = m.system_id
     WHERE s.code = $1 AND m.external_status = $2 AND m.active = TRUE AND s.active = TRUE`,
    [code, status]
  );

  if (row) {
    return { internalStatus: row.internal_status, found: true };
  }

  const systemExists = await get<{ id: number }>(
    'SELECT id FROM integration_systems WHERE code = $1 AND active = TRUE',
    [code]
  );
  if (systemExists) {
    logger.warn('Status externo sem mapeamento ativo', { system: code, externalStatus: status });
  }

  return { internalStatus: null, found: false };
}
