import { describe, expect, it } from 'vitest';
import { maskCPF, maskEmail, maskText } from '../utils/mask.js';

describe('LGPD masking utilities', () => {
  it('masks CPF while preserving the middle digits for visual confirmation', () => {
    expect(maskCPF('123.456.789-01')).toBe('***.456.789-**');
  });

  it('masks the local part of an email and preserves its domain', () => {
    expect(maskEmail('user@domain.com')).toBe('u***r@domain.com');
  });

  it('masks generic text while preserving only its boundaries', () => {
    const masked = maskText('informacao-sensivel');

    expect(masked).toBe(`i${'*'.repeat('informacao-sensivel'.length - 2)}l`);
  });
});
