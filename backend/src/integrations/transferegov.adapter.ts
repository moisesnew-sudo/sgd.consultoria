import {
  IntegrationAdapter,
  NormalizedIntegrationEvent,
  flattenPayload,
  pickString,
  normalizeExternalStatus,
  toIsoDate,
  extractEventType,
} from './types.js';

const PROPOSAL_KEYS = ['proposal_number', 'numero_proposta', 'numeroProposta', 'proposta', 'id_proposta'];
const CONTRACT_KEYS = ['contract_number', 'numero_convenio', 'numeroConvenio', 'convenio', 'contrato'];
const STATUS_KEYS = ['status', 'situacao'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite', 'data_vencimento', 'dataVencimento'];

export const transferegovAdapter: IntegrationAdapter = {
  system: 'transferegov',

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const proposalNumber = pickString(p, PROPOSAL_KEYS);
    const contractNumber = pickString(p, CONTRACT_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber,
      externalId: contractNumber,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(contractNumber ? { contractNumber } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

export default transferegovAdapter;
