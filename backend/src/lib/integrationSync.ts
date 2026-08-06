import { get } from '../database.js';
import { logger } from './logger.js';
import { getAdapter } from './adapterRegistry.js';
import { getMappedStatus } from './statusMapping.js';
import type { IntegrationAdapter } from '../integrations/types.js';

/**
 * Motor de sincronização do Módulo de Integrações Governamentais (Fase 2.2.1).
 *
 * Responsabilidades:
 * 1. Identificar o adapter via event.systemCode;
 * 2. Normalizar o payload bruto do webhook;
 * 3. Validar o resultado normalizado;
 * 4. Localizar a demanda SGD (via demands.proposal_number);
 * 5. Aplicar o mapeamento de status (integration_status_mapping);
 * 6. Preparar o resultado da sincronização.
 *
 * IMPORTANTE: nesta fase o serviço NÃO atualiza demands — apenas prepara e
 * retorna o resultado estruturado. A persistência será feita pelo processador
 * de webhooks (Fase 2.2.2).
 */

export type SyncAction = 'synced' | 'unmatched' | 'ignored' | 'failed';

export interface SyncResult {
  success: boolean;
  action: SyncAction;
  /** Id da demanda SGD localizada (demands.id é TEXT). */
  demandId?: string;
  changes?: {
    status?: string;
    deadline?: string | null;
  };
  /** Metadados normalizados do evento, para persistência em demand_integrations e logs. */
  metadata?: {
    proposalNumber?: string;
    externalId?: string;
    eventType?: string;
  };
  reason?: string;
}

export interface SyncContext {
  systemCode?: string;
  webhookEventId?: number;
  ipAddress?: string;
  source?: string;
}

/**
 * Localiza uma demanda SGD pelo número da proposta (comparação case-insensitive).
 * Retorna a linha encontrada ou undefined. Somente leitura — nunca altera dados.
 */
export async function findDemandByProposalNumber(proposalNumber: string): Promise<{ id: string } | undefined> {
  const normalized = String(proposalNumber || '').trim().toUpperCase();
  if (!normalized) return undefined;
  return get<{ id: string }>(
    'SELECT id FROM demands WHERE UPPER(proposal_number) = $1 AND deleted_at IS NULL',
    [normalized]
  );
}

/**
 * Processa um evento de integração normalizado e prepara o update da demanda.
 * Nunca grava no banco — retorna o resultado para o chamador persistir.
 */
export async function syncIntegrationEvent(payload: unknown, context?: SyncContext): Promise<SyncResult> {
  const source = context?.source || 'integration';
  try {
    const rawSystem = context?.systemCode ?? (payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).systemCode
      : undefined);

    const adapter = getAdapter(String(rawSystem || ''));
    if (!adapter) {
      logger.warn('Adapter não encontrado para o sistema', { system: rawSystem, source });
      return { success: false, action: 'failed', reason: 'adapter not found' };
    }

    let normalized: ReturnType<IntegrationAdapter['normalize']>;
    try {
      normalized = adapter.normalize(payload);
    } catch (error) {
      logger.error('Falha na normalização do payload', { system: adapter.system, error, source });
      return { success: false, action: 'failed', reason: 'normalization failed' };
    }

    if (!normalized || typeof normalized !== 'object' || !normalized.systemCode) {
      logger.error('Evento normalizado inválido', { system: adapter.system, source });
      return { success: false, action: 'failed', reason: 'invalid normalized event' };
    }

    if (!normalized.proposalNumber) {
      logger.warn('Evento sem número de proposta — não é possível localizar demanda', {
        system: normalized.systemCode, eventType: normalized.eventType, source,
      });
      return { success: false, action: 'unmatched', reason: 'demand not found' };
    }

    const demand = await findDemandByProposalNumber(normalized.proposalNumber);
    if (!demand) {
      logger.warn('Demanda não encontrada pelo número da proposta', {
        system: normalized.systemCode, proposalNumber: normalized.proposalNumber, source,
      });
      return { success: false, action: 'unmatched', reason: 'demand not found' };
    }

    const changes: NonNullable<SyncResult['changes']> = {};

    if (normalized.externalStatus) {
      const mapping = await getMappedStatus(normalized.systemCode, normalized.externalStatus);
      if (!mapping.found || !mapping.internalStatus) {
        logger.warn('Status externo sem mapeamento ativo', {
          system: normalized.systemCode, externalStatus: normalized.externalStatus, source,
        });
        return { success: false, action: 'unmatched', reason: 'Unknown external status' };
      }
      changes.status = mapping.internalStatus;
    }

    if (normalized.deadline) {
      changes.deadline = normalized.deadline;
    }

    logger.info('Evento sincronizado (preparação — sem persistência)', {
      system: normalized.systemCode, proposalNumber: normalized.proposalNumber,
      demandId: demand.id, changes, source,
    });

    return {
      success: true,
      action: 'synced',
      demandId: demand.id,
      metadata: {
        proposalNumber: normalized.proposalNumber,
        externalId: normalized.externalId,
        eventType: normalized.eventType,
      },
      ...(Object.keys(changes).length > 0 ? { changes } : {}),
    };
  } catch (error) {
    logger.error('Erro inesperado na sincronização', { error, source });
    return { success: false, action: 'failed', reason: 'sync error' };
  }
}
