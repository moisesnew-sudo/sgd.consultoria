import bcrypt from 'bcryptjs';
import db from './database.js';

async function seed() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // Create default admin user
  const adminPassword = await bcrypt.hash('Admin2026!', 10);
  
  const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@sgd.gov.br');

  if (!existingAdmin) {
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (?, ?, ?, ?)
    `).run('admin@sgd.gov.br', adminPassword, 'Administrador SGD', 'admin');
    console.log('✅ Usuário admin criado: admin@sgd.gov.br / Admin2026!');
  }

  // Create default viewer user
  const viewerPassword = await bcrypt.hash('Visitante2026!', 10);
  
  const existingViewer = db.prepare('SELECT id FROM users WHERE email = ?').get('consulta@sgd.gov.br');

  if (!existingViewer) {
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES (?, ?, ?, ?)
    `).run('consulta@sgd.gov.br', viewerPassword, 'Consultor Público', 'viewer');
    console.log('✅ Usuário viewer criado: consulta@sgd.gov.br / Visitante2026!');
  }

  // Create default municipalities
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

  const insertMunicipality = db.prepare(`
    INSERT OR IGNORE INTO municipalities (name, uf, schools_count, population, hdi, region)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const m of municipalities) {
    insertMunicipality.run(m.name, m.uf, m.schools_count, m.population, m.hdi, m.region);
  }
  console.log(`✅ ${municipalities.length} municípios inseridos`);

  // Create default system settings
  const existingSettings = db.prepare('SELECT id FROM system_settings WHERE id = 1').get();

  if (!existingSettings) {
    db.prepare(`
      INSERT INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap)
      VALUES (1, 45, 30, 15, 5, 1, 1, 15000000)
    `).run();
    console.log('✅ Configurações padrão criadas');
  }

  console.log('\n🎉 Seed concluído com sucesso!');
  console.log('\n📋 Credenciais de acesso:');
  console.log('   Admin: admin@sgd.gov.br / Admin2026!');
  console.log('   Viewer: consulta@sgd.gov.br / Visitante2026!');
}

seed().catch(console.error);