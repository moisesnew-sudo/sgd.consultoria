import type { IntegrationAdapter, GovernmentIntegrationAdapter } from '../integrations/types.js';
import { transferegovAdapter, transferegovGovAdapter } from '../integrations/transferegov.adapter.js';
import { seiAdapter, seiGovAdapter } from '../integrations/sei.adapter.js';
import { cglogAdapter, cglogGovAdapter } from '../integrations/cglog.adapter.js';

/**
 * Registro central de adapters de integração (Fase 2.2 + Fase E1.1).
 *
 * Dois níveis de adapter coexistem para cada sistema:
 * 1. Adapter síncrono puro (IntegrationAdapter) — normalização de webhooks;
 * 2. Adapter governamental (GovernmentIntegrationAdapter) — operações ativas
 *    com autenticação, fetch, validação e sincronização.
 *
 * O registry é a única fonte de verdade para lookup de adapters.
 * Os adapters permanecem funções puras (sem acesso a banco).
 */

// ---------------------------------------------------------------------------
// Registro de adapters síncronos (webhooks — Fase 2.2)
// ---------------------------------------------------------------------------
const ADAPTERS: Record<string, IntegrationAdapter> = {
  transferegov: transferegovAdapter,
  sei: seiAdapter,
  cglog: cglogAdapter,
};

// ---------------------------------------------------------------------------
// Registro de adapters governamentais ativos (Fase E1.1)
// ---------------------------------------------------------------------------
const GOV_ADAPTERS: Record<string, GovernmentIntegrationAdapter> = {
  transferegov: transferegovGovAdapter,
  sei: seiGovAdapter,
  cglog: cglogGovAdapter,
};

const ADAPTER_NAMES: Record<string, string> = {
  transferegov: 'Transferegov',
  sei: 'SEI',
  cglog: 'CGLOG',
};

const ADAPTER_DESCRIPTIONS: Record<string, string> = {
  transferegov: 'Integração com o Transferegov — gestão de transferências voluntárias',
  sei: 'Integração com o SEI — Sistema Eletrônico de Informações',
  cglog: 'Integração com o CGLOG — logs de acesso e rastreamento',
};

/**
 * Retorna o adapter síncrono do sistema (case/accent-insensitive) ou undefined
 * quando o sistema é desconhecido.
 * Usado pelo integrationSync e integrationProcessor para normalização de webhooks.
 */
export function getAdapter(systemCode: string): IntegrationAdapter | undefined {
  const code = String(systemCode || '').toLowerCase().trim();
  return ADAPTERS[code] ?? undefined;
}

/**
 * Retorna o adapter governamental do sistema (Fase E1.1) ou undefined.
 * Utilizado para operações ativas: authenticate, fetch, validate, sync.
 */
export function getGovAdapter(systemCode: string): GovernmentIntegrationAdapter | undefined {
  const code = String(systemCode || '').toLowerCase().trim();
  return GOV_ADAPTERS[code] ?? undefined;
}

/**
 * Verifica se um sistema possui adapter governamental registrado.
 */
export function hasGovAdapter(systemCode: string): boolean {
  const code = String(systemCode || '').toLowerCase().trim();
  return code in GOV_ADAPTERS;
}

/**
 * Lista os adapters síncronos registrados (Fase 3.1 — backend administrativo).
 * Usado pelo painel para expor os sistemas com adapter disponível.
 */
export function listAdapters(): { code: string; name: string; hasGovAdapter: boolean; description: string }[] {
  const allCodes = new Set([...Object.keys(ADAPTERS), ...Object.keys(GOV_ADAPTERS)]);
  return Array.from(allCodes).map((code) => ({
    code,
    name: ADAPTER_NAMES[code] ?? code,
    hasGovAdapter: code in GOV_ADAPTERS,
    description: ADAPTER_DESCRIPTIONS[code] ?? `Adapter para ${code}`,
  }));
}
