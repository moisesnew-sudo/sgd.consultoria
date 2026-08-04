import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from '../database.js';
import { logger } from '../lib/logger.js';
import { buildStandardizationScan, applyStandardizationScan } from '../lib/standardization.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rotina de padronização dos dados existentes do SGD.
 *
 *   npm run standardize            -> apenas relatório (sem alterar dados)
 *   npm run standardize -- --apply  -> gera relatório + aplica as correções
 *
 * O relatório é gravado em <repo>/standardize-report.json e exibido no console.
 */
async function main() {
  const apply = process.argv.includes('--apply');

  await initDatabase();
  logger.info('Iniciando padronização...', { apply });

  const report = apply ? await applyStandardizationScan() : await buildStandardizationScan();

  const outPath = path.join(__dirname, '..', '..', 'standardize-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  logger.info(`Relatório salvo em ${outPath}`);

  console.log('\n===== RELATÓRIO DE PADRONIZAÇÃO =====');
  console.log(`Modo: ${apply ? 'Aplicar correções' : 'Somente leitura'}`);
  console.log('--- Municípios ---');
  console.log(`  Total:                       ${report.municipalities.total}`);
  console.log(`  Grafia corrigida:            ${report.municipalities.canonicalized.length}`);
  for (const c of report.municipalities.canonicalized) {
    console.log(`    - ${c.value} (${c.uf}) -> ${c.correctedTo}`);
  }
  console.log(`  Duplicatas:                  ${report.municipalities.duplicates.length}`);
  for (const d of report.municipalities.duplicates) {
    console.log(`    - ${d.value} (${d.uf}) - ${d.reason}`);
  }
  console.log(`  Não existentes no IBGE:      ${report.municipalities.notInIbge.length} (revisão manual)`);
  for (const n of report.municipalities.notInIbge) {
    console.log(`    - ${n.value} (${n.uf})`);
  }
  console.log('--- Demandas ---');
  console.log(`  Total:                       ${report.demands.total}`);
  console.log(`  Municípios distintos:        ${report.demands.distinct}`);
  console.log(`  Corrigidos:                  ${report.demands.corrected.length}`);
  for (const c of report.demands.corrected) {
    console.log(`    - ${c.value} (${c.uf}) -> ${c.correctedTo}`);
  }
  console.log(`  Não existentes:              ${report.demands.notInIbge.length} (revisão manual)`);
  for (const n of report.demands.notInIbge) {
    console.log(`    - ${n.value} (${n.uf})`);
  }

  const manualCount =
    report.municipalities.notInIbge.length + report.demands.notInIbge.length;
  if (manualCount > 0) {
    console.warn(`\n⚠️  ${manualCount} registro(s) exigem revisão manual (não são do IBGE).`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('Falha na padronização', { error: err instanceof Error ? err.message : err });
    process.exit(1);
  });