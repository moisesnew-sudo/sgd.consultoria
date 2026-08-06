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
const PROTOCOL_KEYS = ['protocolo', 'numero_protocolo', 'numeroProtocolo', 'protocol'];
const STATUS_KEYS = ['status', 'situacao'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite'];

export const cglogAdapter: IntegrationAdapter = {
  system: 'cglog',

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const protocol = pickString(p, PROTOCOL_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber: pickString(p, PROPOSAL_KEYS),
      externalId: protocol,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(protocol ? { protocol } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

export default cglogAdapter;
