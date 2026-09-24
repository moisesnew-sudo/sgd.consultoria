import { get, all, run } from '../database.js';

// ETAPA 4 (AUXAMO) — Capabilities por organizacao (fail closed).
// Fonte unica de leitura/escrita de capabilities: nenhum outro modulo deve
// fazer queries SQL de capability diretamente. Regra critica: linha ausente
// ou enabled=false => DESABILITADO. Nunca undefined => true.
// Nenhuma API administrativa publica expoe estas funcoes nesta etapa;
// setOrganizationCapability existe para seed/testes e futuro painel admin.

// Identificador canonico da primeira capability. Novos recursos adicionam
// novos literais a este union — nunca aliases paralelos espalhados no codigo.
export type OrganizationCapability = 'government_integrations';

export const GOVERNMENT_INTEGRATIONS: OrganizationCapability = 'government_integrations';

const KNOWN_CAPABILITIES: readonly string[] = [GOVERNMENT_INTEGRATIONS];

function isValidCapability(capability: unknown): capability is OrganizationCapability {
  return (
    typeof capability === 'string' &&
    capability.length >= 1 &&
    capability.length <= 100 &&
    (KNOWN_CAPABILITIES as readonly string[]).includes(capability)
  );
}

function isValidOrganizationId(organizationId: unknown): organizationId is number {
  return typeof organizationId === 'number' && Number.isInteger(organizationId) && organizationId >= 1;
}

// Fail closed: qualquer entrada invalida ou linha ausente/desabilitada => false.
export async function hasOrganizationCapability(
  organizationId: number,
  capability: OrganizationCapability
): Promise<boolean> {
  if (!isValidOrganizationId(organizationId) || !isValidCapability(capability)) return false;
  const row = await get<{ enabled: boolean }>(
    `SELECT enabled FROM organization_capabilities
     WHERE organization_id = $1 AND capability = $2`,
    [organizationId, capability]
  );
  return row?.enabled === true;
}

export async function getOrganizationCapabilities(
  organizationId: number
): Promise<Record<string, boolean>> {
  if (!isValidOrganizationId(organizationId)) return {};
  const rows = await all<{ capability: string; enabled: boolean }>(
    `SELECT capability, enabled FROM organization_capabilities
     WHERE organization_id = $1 ORDER BY capability ASC`,
    [organizationId]
  );
  const out: Record<string, boolean> = {};
  for (const row of rows) {
    out[row.capability] = row.enabled === true;
  }
  return out;
}

// Uso interno (seed, testes, futuro painel admin). Upsert idempotente;
// nunca reabilita implicitamente nada alem do valor passado.
export async function setOrganizationCapability(
  organizationId: number,
  capability: OrganizationCapability,
  enabled: boolean
): Promise<void> {
  if (!isValidOrganizationId(organizationId)) {
    throw new Error('organizationId inválido');
  }
  if (!isValidCapability(capability)) {
    throw new Error('capability desconhecida');
  }
  await run(
    `INSERT INTO organization_capabilities (organization_id, capability, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (organization_id, capability)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [organizationId, capability, enabled === true]
  );
}
