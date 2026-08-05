import { describe, it, expect } from 'vitest';
import { applyStandardizationScan } from '../lib/standardization.js';

describe('debug apply 2', () => {
  it('prints error', async () => {
    try {
      const applied = await applyStandardizationScan();
      console.log('APPLY OK, corrected=', JSON.stringify(applied.demands.corrected).slice(0, 200));
    } catch (e) {
      console.log('APPLY ERROR:', e instanceof Error ? e.message : e);
      throw e;
    }
    expect(true).toBe(true);
  }, 30000);
});