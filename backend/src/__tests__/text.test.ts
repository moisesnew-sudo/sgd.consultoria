import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  comparisonKey,
  canonicalMunicipality,
  findOfficialMunicipality,
  suggestMunicipalities,
  regionForUf,
} from '../lib/text.js';

describe('normalizeText', () => {
  it('colapsa espaços múltiplos e remove bordas', () => {
    expect(normalizeText('  SAO   PAULO  ')).toBe('SAO PAULO');
  });

  it('colapsa espaço não separável e converte para NFC', () => {
    expect(normalizeText('GOI\u00E2nia\u00A0\u00A0SP')).toBe('GOIânia SP');
  });

  it('preserva acentos', () => {
    expect(normalizeText('CÁCERES')).toBe('CÁCERES');
  });
});

describe('comparisonKey', () => {
  it('ignora acentos e caixa', () => {
    expect(comparisonKey('CÁCERES')).toBe(comparisonKey('caceres'));
  });

  it('ignora diferenças de espaçamento', () => {
    expect(comparisonKey('SÃO PAULO')).toBe(comparisonKey('Sao   Paulo'));
  });
});

describe('canonicalMunicipality', () => {
  it('corrige grafia sem acento para a oficial', () => {
    const res = canonicalMunicipality('CACERES', 'MT');
    expect(res).toEqual({ nome: 'CÁCERES', uf: 'MT' });
  });

  it('resolve nome único mesmo sem UF e corrige a UF', () => {
    const res = canonicalMunicipality('goiania');
    expect(res).toEqual({ nome: 'GOIÂNIA', uf: 'GO' });
  });

  it('resolve nome com caixa mista', () => {
    const res = canonicalMunicipality('São Paulo', 'SP');
    expect(res).toEqual({ nome: 'SÃO PAULO', uf: 'SP' });
  });

  it('retorna null para município inexistente', () => {
    expect(canonicalMunicipality('CIDADE INVENTADA', 'XX')).toBeNull();
  });

  it('retorna null para nome duplicado entre UFs sem UF informada', () => {
    expect(canonicalMunicipality('ÁGUA BOA')).toBeNull();
  });

  it('desambigua nome duplicado usando a UF', () => {
    const res = canonicalMunicipality('ÁGUA BOA', 'MT');
    expect(res).toEqual({ nome: 'ÁGUA BOA', uf: 'MT' });
  });

  it('corrige a UF quando o nome é único na base oficial', () => {
    const res = canonicalMunicipality('CÁCERES', 'SP');
    expect(res).toEqual({ nome: 'CÁCERES', uf: 'MT' });
  });

  // Exemplos do relatório de auditoria (item 7 — Padronização automática).
  it('"   GOIANIA   " -> "GOIÂNIA"', () => {
    expect(canonicalMunicipality('   GOIANIA   ', 'GO')).toEqual({ nome: 'GOIÂNIA', uf: 'GO' });
  });

  it('"caceres" -> "CÁCERES"', () => {
    expect(canonicalMunicipality('caceres', 'MT')).toEqual({ nome: 'CÁCERES', uf: 'MT' });
  });

  it('"Sao Paulo" -> "SÃO PAULO"', () => {
    expect(canonicalMunicipality('Sao Paulo', 'SP')).toEqual({ nome: 'SÃO PAULO', uf: 'SP' });
  });
});

describe('findOfficialMunicipality', () => {
  it('aceita o par (nome, UF) válido', () => {
    const res = findOfficialMunicipality('RIBEIRÃO PRETO', 'SP');
    expect(res).toEqual({ nome: 'RIBEIRÃO PRETO', uf: 'SP' });
  });

  it('rejeita par inválido', () => {
    expect(findOfficialMunicipality('RIBEIRÃO PRETO', 'CE')).toBeNull();
  });
});

describe('suggestMunicipalities', () => {
  it('busca por prefixo ignorando acentos', () => {
    const res = suggestMunicipalities('sao', 'SP', 50);
    expect(res.some(s => s.nome === 'SÃO PAULO')).toBe(true);
  });

  it('busca por prefixo ignorando caixa', () => {
    const res = suggestMunicipalities('PETRO');
    expect(res.some(s => s.nome === 'PETROLINA' && s.uf === 'PE')).toBe(true);
  });

  it('restringe por UF quando informada', () => {
    const res = suggestMunicipalities('jua', 'CE');
    expect(res.every(s => s.uf === 'CE')).toBe(true);
    expect(res.some(s => s.nome === 'JUAZEIRO DO NORTE')).toBe(true);
  });

  it('retorna lista vazia sem consulta', () => {
    expect(suggestMunicipalities('')).toEqual([]);
  });
});

describe('regionForUf', () => {
  it('mapeia UF para região', () => {
    expect(regionForUf('go')).toBe('Centro-Oeste');
    expect(regionForUf('CE')).toBe('Nordeste');
    expect(regionForUf('SP')).toBe('Sudeste');
    expect(regionForUf('ZZ')).toBeUndefined();
  });
});