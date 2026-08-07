import type { IntegrationAdapter } from '../integrations/types.js';
import transferegovAdapter from '../integrations/transferegov.adapter.js';
import seiAdapter from '../integrations/sei.adapter.js';
import cglogAdapter from '../integrations/cglog.adapter.js';

/**
 * Registro central de adapters de integração (Fase 2.2).
 * Mapeia o código canônico do sistema para o adapter correspondente.
 * Sem acesso a banco — os adapters permanecem funções puras.
 */
const ADAPTERS: Record<string, IntegrationAdapter> = {
  transferegov: transferegovAdapter,
  sei: seiAdapter,
  cglog: cglogAdapter,
};

/**
 * Retorna o adapter do sistema (case/accent-insensitive) ou undefined
 * quando o sistema é desconhecido.
 */
export function getAdapter(systemCode: string): IntegrationAdapter | undefined {
  const code = String(systemCode || '').toLowerCase().trim();
  return ADAPTERS[code] ?? undefined;
}

const ADAPTER_NAMES: Record<string, string> = {
  transferegov: 'Transferegov',
  sei: 'SEI',
  cglog: 'CGLOG',
};

/**
 * Lista os adapters registrados (Fase 3.1 — backend administrativo).
 * Usado pelo painel para expor os sistemas com adapter disponível.
 */
export function listAdapters(): { code: string; name: string }[] {
  return Object.keys(ADAPTERS).map((code) => ({ code, name: ADAPTER_NAMES[code] ?? code }));
}
