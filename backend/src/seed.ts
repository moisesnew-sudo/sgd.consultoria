import bcrypt from 'bcryptjs';
import { get, run } from './database.js';

export async function runSeed() {
  console.log('🌱 Verificando dados iniciais...');

  const adminPassword = await bcrypt.hash('Admin2026!', 10);
  const existingAdmin = await get('SELECT id FROM users WHERE email = $1', ['admin@sgd.gov.br']);

  if (!existingAdmin) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['admin@sgd.gov.br', adminPassword, 'Administrador SGD', 'admin']
    );
    console.log('✅ Usuário admin criado: admin@sgd.gov.br / Admin2026!');
  }

  const viewerPassword = await bcrypt.hash('Visitante2026!', 10);
  const existingViewer = await get('SELECT id FROM users WHERE email = $1', ['consulta@sgd.gov.br']);

  if (!existingViewer) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['consulta@sgd.gov.br', viewerPassword, 'Consultor Público', 'consulta']
    );
    console.log('✅ Usuário consulta criado: consulta@sgd.gov.br / Visitante2026!');
  }

  const gestorPassword = await bcrypt.hash('Gestor2026!', 10);
  const existingGestor = await get('SELECT id FROM users WHERE email = $1', ['gestor@sgd.gov.br']);

  if (!existingGestor) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['gestor@sgd.gov.br', gestorPassword, 'Gestor SGD', 'gestor']
    );
    console.log('✅ Usuário gestor criado: gestor@sgd.gov.br / Gestor2026!');
  }

  const analistaPassword = await bcrypt.hash('Analista2026!', 10);
  const existingAnalista = await get('SELECT id FROM users WHERE email = $1', ['analista@sgd.gov.br']);

  if (!existingAnalista) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['analista@sgd.gov.br', analistaPassword, 'Analista SGD', 'analista']
    );
    console.log('✅ Usuário analista criado: analista@sgd.gov.br / Analista2026!');
  }

  const municipalities = [
    { name: 'Sobral', uf: 'CE', schools_count: 52, population: 210000, hdi: 0.788, region: 'Nordeste' },
    { name: 'Petrolina', uf: 'PE', schools_count: 48, population: 350000, hdi: 0.702, region: 'Nordeste' },
    { name: 'Ouro Preto', uf: 'MG', schools_count: 24, population: 74000, hdi: 0.741, region: 'Sudeste' },
    { name: 'Ribeirão Preto', uf: 'SP', schools_count: 95, population: 710000, hdi: 0.800, region: 'Sudeste' },
    { name: 'Parintins', uf: 'AM', schools_count: 35, population: 115000, hdi: 0.658, region: 'Norte' },
    { name: 'Caxias do Sul', uf: 'RS', schools_count: 82, population: 510000, hdi: 0.782, region: 'Sul' },
    { name: 'Juazeiro do Norte', uf: 'CE', schools_count: 40, population: 275000, hdi: 0.694, region: 'Nordeste' },
    { name: 'Palmas', uf: 'TO', schools_count: 44, population: 300000, hdi: 0.788, region: 'Norte' },
    { name: 'Três Lagoas', uf: 'MS', schools_count: 19, population: 125000, hdi: 0.750, region: 'Centro-Oeste' },
    { name: 'Goiânia', uf: 'GO', schools_count: 120, population: 1500000, hdi: 0.799, region: 'Centro-Oeste' }
  ];

  for (const m of municipalities) {
    await run(
      'INSERT INTO municipalities (name, uf, schools_count, population, hdi, region) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (name, uf) DO NOTHING',
      [m.name, m.uf, m.schools_count, m.population, m.hdi, m.region]
    );
  }
  console.log(`✅ ${municipalities.length} municípios inseridos`);

  const existingSettings = await get('SELECT id FROM system_settings WHERE id = 1');
  if (!existingSettings) {
    await run(
      'INSERT INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap) VALUES (1, 45, 30, 15, 5, TRUE, TRUE, 15000000) ON CONFLICT (id) DO NOTHING'
    );
    console.log('✅ Configurações padrão criadas');
  }

  console.log('\n🎉 Seed concluído com sucesso!');
  console.log('\n📋 Credenciais de acesso:');
  console.log('   Admin:    admin@sgd.gov.br / Admin2026!');
  console.log('   Gestor:   gestor@sgd.gov.br / Gestor2026!');
  console.log('   Analista: analista@sgd.gov.br / Analista2026!');
  console.log('   Consulta: consulta@sgd.gov.br / Visitante2026!');
}

if (process.argv[1] && process.argv[1].includes('seed')) {
  runSeed().catch(console.error);
}