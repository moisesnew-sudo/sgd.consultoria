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
const PROCESS_KEYS = ['numero_processo', 'process_number', 'processNumber', 'processo', 'nup'];
const STATUS_KEYS = ['status', 'situacao', 'tramite'];
const DEADLINE_KEYS = ['deadline', 'prazo', 'data_limite', 'dataLimite', 'data_finalizacao', 'dataFinalizacao'];
const EXTRA_DATE_KEYS = ['data_abertura', 'dataAbertura', 'data_criacao', 'dataCriacao'];

export const seiAdapter: IntegrationAdapter = {
  system: 'sei',

  normalize(payload: unknown): NormalizedIntegrationEvent {
    const p = flattenPayload(payload);
    const processNumber = pickString(p, PROCESS_KEYS);
    const rawStatus = pickString(p, STATUS_KEYS);
    const extraDates: Record<string, unknown> = {};

    for (const key of EXTRA_DATE_KEYS) {
      const iso = toIsoDate(p[key]);
      if (iso) extraDates[key] = iso;
    }

    return {
      systemCode: this.system,
      eventType: extractEventType(p),
      proposalNumber: pickString(p, PROPOSAL_KEYS),
      externalId: processNumber,
      externalStatus: normalizeExternalStatus(rawStatus),
      deadline: toIsoDate(pickString(p, DEADLINE_KEYS)),
      extra: {
        ...(processNumber ? { processNumber } : {}),
        ...(Object.keys(extraDates).length > 0 ? { dates: extraDates } : {}),
        ...(rawStatus ? { rawStatus } : {}),
      },
    };
  },
};

export default seiAdapter;
