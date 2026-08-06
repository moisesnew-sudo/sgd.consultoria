import { describe, it, expect } from 'vitest';
import { transferegovAdapter } from '../integrations/transferegov.adapter.js';
import { seiAdapter } from '../integrations/sei.adapter.js';
import { cglogAdapter } from '../integrations/cglog.adapter.js';
import { normalizeExternalStatus, toIsoDate } from '../integrations/types.js';

describe('Adapters de Integração — payload válido', () => {
  it('Transferegov extrai proposta, convênio, status e prazo', () => {
    const evt = transferegovAdapter.normalize({
      event: 'demand.updated',
      numero_proposta: 'PROP-2026-001',
      numero_convenio: 'CONV-2026-001',
      status: 'APROVADO',
      prazo: '2026-12-31',
    });
    expect(evt.systemCode).toBe('transferegov');
    expect(evt.eventType).toBe('demand.updated');
    expect(evt.proposalNumber).toBe('PROP-2026-001');
    expect(evt.externalId).toBe('CONV-2026-001');
    expect(evt.externalStatus).toBe('APROVADO');
    expect(evt.deadline).toBe('2026-12-31T00:00:00.000Z');
    expect(evt.extra?.contractNumber).toBe('CONV-2026-001');
  });

  it('SEI extrai número do processo, proposta e datas', () => {
    const evt = seiAdapter.normalize({
      event: 'processo.atualizado',
      numero_processo: '00100.123456/2026-01',
      proposta: 'PROP-SEI-42',
      situacao: 'TRAMITANDO',
      data_finalizacao: '2026-09-30',
      data_abertura: '2026-01-15',
    });
    expect(evt.systemCode).toBe('sei');
    expect(evt.proposalNumber).toBe('PROP-SEI-42');
    expect(evt.externalId).toBe('00100.123456/2026-01');
    expect(evt.externalStatus).toBe('TRAMITANDO');
    expect(evt.deadline).toBe('2026-09-30T00:00:00.000Z');
    expect(evt.extra?.dates).toBeDefined();
  });

  it('CGLOG extrai protocolo, proposta e status', () => {
    const evt = cglogAdapter.normalize({
      event: 'demand.synced',
      protocolo: 'PROT-999',
      proposal_number: 'PROP-CG-7',
      status: 'CONCLUIDO',
    });
    expect(evt.systemCode).toBe('cglog');
    expect(evt.proposalNumber).toBe('PROP-CG-7');
    expect(evt.externalId).toBe('PROT-999');
    expect(evt.externalStatus).toBe('CONCLUIDO');
  });

  it('aceita envelope aninhado { event, data: {...} }', () => {
    const evt = transferegovAdapter.normalize({
      event: 'demand.updated',
      data: { proposta: 'PROP-ENV-1', status: 'EM ANÁLISE', contrato: 2026001 },
    });
    expect(evt.proposalNumber).toBe('PROP-ENV-1');
    expect(evt.externalStatus).toBe('EM_ANALISE');
    expect(evt.externalId).toBe('2026001');
  });
});

describe('Adapters de Integração — payload incompleto', () => {
  it('Transferegov com payload mínimo não lança e retorna campos opcionais undefined', () => {
    const evt = transferegovAdapter.normalize({ event: 'demand.updated' });
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalId).toBeUndefined();
    expect(evt.externalStatus).toBeUndefined();
    expect(evt.deadline).toBeUndefined();
    expect(evt.eventType).toBe('demand.updated');
  });

  it('SEI sem proposta retorna proposalNumber undefined (campo não assumido)', () => {
    const evt = seiAdapter.normalize({ numero_processo: 'PROC-1', status: 'FINALIZADO' });
    expect(evt.externalId).toBe('PROC-1');
    expect(evt.proposalNumber).toBeUndefined();
    expect(evt.externalStatus).toBe('FINALIZADO');
  });

  it('CGLOG sem prazo retorna deadline undefined', () => {
    const evt = cglogAdapter.normalize({ protocolo: 'PROT-1', status: 'EM_ANALISE' });
    expect(evt.externalId).toBe('PROT-1');
    expect(evt.deadline).toBeUndefined();
  });

  it("payload vazio/nulo/array/string não lança e retorna evento 'unknown'", () => {
    for (const garbage of [null, undefined, {}, [], 'texto', 42, true]) {
      const evt = seiAdapter.normalize(garbage as any);
      expect(evt.systemCode).toBe('sei');
      expect(evt.eventType).toBe('unknown');
      expect(evt.proposalNumber).toBeUndefined();
      expect(evt.externalId).toBeUndefined();
      expect(evt.externalStatus).toBeUndefined();
      expect(evt.deadline).toBeUndefined();
    }
  });
});

describe('Adapters de Integração — normalização de status', () => {
  it('normalizeExternalStatus: CAIXA ALTA, sem acentos, espaços viram underscore', () => {
    expect(normalizeExternalStatus('aprovado')).toBe('APROVADO');
    expect(normalizeExternalStatus('em análise')).toBe('EM_ANALISE');
    expect(normalizeExternalStatus('  em analise ')).toBe('EM_ANALISE');
    expect(normalizeExternalStatus('Pendente')).toBe('PENDENTE');
    expect(normalizeExternalStatus('em-andamento')).toBe('EM_ANDAMENTO');
  });

  it('normalizeExternalStatus: vazio/ausente retorna undefined', () => {
    expect(normalizeExternalStatus(undefined)).toBeUndefined();
    expect(normalizeExternalStatus(null)).toBeUndefined();
    expect(normalizeExternalStatus('   ')).toBeUndefined();
  });

  it('toIsoDate: data válida convertida, inválida/ausente retorna undefined', () => {
    expect(toIsoDate('2026-08-05')).toBe('2026-08-05T00:00:00.000Z');
    expect(toIsoDate('31/02/2026')).toBeUndefined();
    expect(toIsoDate('nao-e-data')).toBeUndefined();
    expect(toIsoDate(undefined)).toBeUndefined();
  });
});

describe('Adapters de Integração — systemCode e contrato', () => {
  it('todos os adapters preenchem systemCode com o código canônico', () => {
    expect(transferegovAdapter.normalize({}).systemCode).toBe('transferegov');
    expect(seiAdapter.normalize({}).systemCode).toBe('sei');
    expect(cglogAdapter.normalize({}).systemCode).toBe('cglog');
  });
});
