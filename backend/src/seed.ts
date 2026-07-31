import bcrypt from 'bcryptjs';
import { get, run, all } from './database.js';
import { logger } from './lib/logger.js';

export async function runSeed() {
  logger.info('🌱 Verificando dados iniciais...');

  const defaultPwd = () => process.env.SEED_DEFAULT_PASSWORD || 'Sgd@2026!';
  const adminPassword = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || defaultPwd(), 10);
  const existingAdmin = await get('SELECT id FROM users WHERE email = $1', ['admin@sgd.gov.br']);

  if (!existingAdmin) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['admin@sgd.gov.br', adminPassword, 'Administrador SGD', 'admin']
    );
    logger.info('✅ Usuário admin criado: admin@sgd.gov.br / Admin2026!');
  }

  const viewerPassword = await bcrypt.hash(process.env.SEED_VIEWER_PASSWORD || defaultPwd(), 10);
  const existingViewer = await get('SELECT id FROM users WHERE email = $1', ['consulta@sgd.gov.br']);

  if (!existingViewer) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['consulta@sgd.gov.br', viewerPassword, 'Consultor Público', 'consulta']
    );
    logger.info('✅ Usuário consulta criado: consulta@sgd.gov.br / Visitante2026!');
  }

  const gestorPassword = await bcrypt.hash(process.env.SEED_GESTOR_PASSWORD || defaultPwd(), 10);
  const existingGestor = await get('SELECT id FROM users WHERE email = $1', ['gestor@sgd.gov.br']);

  if (!existingGestor) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['gestor@sgd.gov.br', gestorPassword, 'Gestor SGD', 'gestor']
    );
    logger.info('✅ Usuário gestor criado: gestor@sgd.gov.br / Gestor2026!');
  }

  const analistaPassword = await bcrypt.hash(process.env.SEED_ANALISTA_PASSWORD || defaultPwd(), 10);
  const existingAnalista = await get('SELECT id FROM users WHERE email = $1', ['analista@sgd.gov.br']);

  if (!existingAnalista) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['analista@sgd.gov.br', analistaPassword, 'Analista SGD', 'analista']
    );
    logger.info('✅ Usuário analista criado: analista@sgd.gov.br / Analista2026!');
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
  logger.info(`✅ ${municipalities.length} municípios inseridos`);

  // Seed permissions (always runs — ON CONFLICT DO NOTHING avoids duplicates)
  const permissions = [
    { key: 'dashboard.view', name: 'Visualizar Dashboard', category: 'Dashboard', description: 'Acessar o painel de dashboard' },
    { key: 'demands.view', name: 'Visualizar Demandas', category: 'Demandas', description: 'Visualizar a lista de demandas' },
    { key: 'demands.create', name: 'Cadastrar Demandas', category: 'Demandas', description: 'Criar novas demandas' },
    { key: 'demands.edit', name: 'Editar Demandas', category: 'Demandas', description: 'Editar demandas existentes' },
    { key: 'demands.delete', name: 'Excluir Demandas', category: 'Demandas', description: 'Excluir demandas' },
    { key: 'demands.export_excel', name: 'Exportar Excel', category: 'Demandas', description: 'Exportar dados para Excel' },
    { key: 'demands.export_pdf', name: 'Exportar PDF', category: 'Demandas', description: 'Exportar dados para PDF' },
    { key: 'reports.view', name: 'Visualizar Relatórios', category: 'Relatórios', description: 'Acessar a seção de relatórios' },
    { key: 'reports.emit', name: 'Emitir Relatórios', category: 'Relatórios', description: 'Gerar relatórios' },
    { key: 'reports.print', name: 'Imprimir Relatórios', category: 'Relatórios', description: 'Imprimir relatórios' },
    { key: 'reports.export', name: 'Exportar Relatórios', category: 'Relatórios', description: 'Exportar relatórios' },
    { key: 'users.view', name: 'Visualizar Usuários', category: 'Usuários', description: 'Visualizar lista de usuários' },
    { key: 'users.create', name: 'Cadastrar Usuários', category: 'Usuários', description: 'Criar novos usuários' },
    { key: 'users.edit', name: 'Editar Usuários', category: 'Usuários', description: 'Editar usuários existentes' },
    { key: 'users.delete', name: 'Excluir Usuários', category: 'Usuários', description: 'Excluir usuários' },
    { key: 'users.manage_permissions', name: 'Gerenciar Permissões', category: 'Usuários', description: 'Gerenciar permissões de acesso' },
    { key: 'settings.view', name: 'Visualizar Configurações', category: 'Configurações', description: 'Acessar a tela de configurações' },
    { key: 'settings.edit', name: 'Alterar Configurações', category: 'Configurações', description: 'Modificar configurações do sistema' },
    { key: 'audit.view', name: 'Auditoria - Visualizar Logs', category: 'Auditoria', description: 'Visualizar logs de auditoria' },
    { key: 'audit.dashboard', name: 'Auditoria - Dashboard', category: 'Auditoria', description: 'Visualizar dashboard de auditoria' },
    { key: 'audit.export', name: 'Auditoria - Exportar Logs', category: 'Auditoria', description: 'Exportar logs de auditoria' },
    { key: 'sessions.view', name: 'Sessões - Visualizar', category: 'Auditoria', description: 'Visualizar sessões ativas' },
    { key: 'sessions.terminate', name: 'Sessões - Encerrar', category: 'Auditoria', description: 'Encerrar sessões ativas' },
    { key: 'backups.view', name: 'Backups - Visualizar', category: 'Auditoria', description: 'Visualizar backups' },
    { key: 'backups.create', name: 'Backups - Criar', category: 'Auditoria', description: 'Criar novos backups' },
    { key: 'backups.restore', name: 'Backups - Restaurar', category: 'Auditoria', description: 'Restaurar backups' },
    { key: 'monitoring.view', name: 'Monitoramento - Visualizar', category: 'Auditoria', description: 'Visualizar monitoramento do sistema' },
    { key: 'lgpd.view', name: 'LGPD - Visualizar', category: 'Auditoria', description: 'Visualizar painel LGPD' },
  ];

  for (const p of permissions) {
    await run(
      'INSERT INTO permissions (key, name, category, description) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING',
      [p.key, p.name, p.category, p.description]
    );
  }

  const allPerms = await all<{ id: number; key: string }>('SELECT id, key FROM permissions');

  const permMap: Record<string, number> = {};
  for (const p of allPerms) {
    permMap[p.key] = p.id;
  }

  const adminPerms = allPerms.map(p => p.id);
  const gestorPerms = [
    'dashboard.view', 'demands.view', 'demands.create', 'demands.edit', 'demands.delete',
    'demands.export_excel', 'demands.export_pdf',
    'reports.view', 'reports.emit', 'reports.print', 'reports.export',
    'users.view', 'users.create', 'users.delete',
    'audit.view', 'sessions.view', 'backups.view', 'monitoring.view', 'lgpd.view'
  ].filter(k => permMap[k]).map(k => permMap[k]);
  const analistaPerms = [
    'dashboard.view', 'demands.view', 'demands.create', 'demands.edit',
    'demands.export_excel', 'demands.export_pdf',
    'reports.view', 'reports.export'
  ].filter(k => permMap[k]).map(k => permMap[k]);
  const consultaPerms = [
    'dashboard.view', 'demands.view',
    'reports.view', 'reports.export'
  ].filter(k => permMap[k]).map(k => permMap[k]);

  const rolePerms: Record<string, number[]> = {
    admin: adminPerms,
    gestor: gestorPerms,
    analista: analistaPerms,
    consulta: consultaPerms,
  };

  for (const [role, permIds] of Object.entries(rolePerms)) {
    for (const permId of permIds) {
      await run(
        'INSERT INTO role_permissions (role, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [role, permId]
      );
    }
  }

  logger.info('✅ Permissões e perfis sincronizados');

  // Seed new roles (idempotent)
  const NEW_USERS: { email: string; password: string; name: string; role: string }[] = [
    { email: 'diretor@sgd.gov.br', password: process.env.SEED_DIRETOR_PASSWORD || defaultPwd(), name: 'Diretor SGD', role: 'diretor' },
    { email: 'tecnico@sgd.gov.br', password: process.env.SEED_TECNICO_PASSWORD || defaultPwd(), name: 'Técnico SGD', role: 'tecnico' },
    { email: 'parceiro@sgd.gov.br', password: process.env.SEED_PARCEIRO_PASSWORD || defaultPwd(), name: 'Parceiro SGD', role: 'parceiro' },
    { email: 'cliente@sgd.gov.br', password: process.env.SEED_CLIENTE_PASSWORD || defaultPwd(), name: 'Cliente SGD', role: 'cliente' },
    { email: 'visitante@sgd.gov.br', password: process.env.SEED_VISITANTE_PASSWORD || defaultPwd(), name: 'Visitante', role: 'visitante' },
  ];

  for (const nu of NEW_USERS) {
    const existing = await get('SELECT id FROM users WHERE email = $1', [nu.email]);
    if (!existing) {
      const pw = await bcrypt.hash(nu.password, 10);
      await run(
        'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
        [nu.email, pw, nu.name, nu.role]
      );
    }
  }

  const newRolePerms: Record<string, number[]> = {
    diretor: gestorPerms,
    tecnico: analistaPerms,
    parceiro: ['dashboard.view', 'demands.view', 'reports.view', 'reports.export'].filter(k => permMap[k]).map(k => permMap[k]),
    cliente: ['dashboard.view', 'demands.view'].filter(k => permMap[k]).map(k => permMap[k]),
    visitante: ['dashboard.view'].filter(k => permMap[k]).map(k => permMap[k]),
  };

  for (const [role, permIds] of Object.entries(newRolePerms)) {
    for (const permId of permIds) {
      await run(
        'INSERT INTO role_permissions (role, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [role, permId]
      );
    }
  }

  // Sincroniza permissões do perfil para usuários existentes (ON CONFLICT preserva ajustes individuais)
  const seedUsers = await all<{ id: number; role: string }>('SELECT id, role FROM users WHERE deleted_at IS NULL');
  for (const su of seedUsers) {
    const rolePermsForUser = await all<{ permission_id: number }>(
      'SELECT permission_id FROM role_permissions WHERE role = $1', [su.role]
    );
    for (const rp of rolePermsForUser) {
      await run(
        'INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, TRUE) ON CONFLICT (user_id, permission_id) DO NOTHING',
        [su.id, rp.permission_id]
      );
    }
  }

  const existingSettings = await get('SELECT id FROM system_settings WHERE id = 1');
  if (!existingSettings) {
    await run(
      'INSERT INTO system_settings (id, sla_days_baixa, sla_days_media, sla_days_alta, sla_days_urgente, auto_triage, email_notifications, budget_cap) VALUES (1, 45, 30, 15, 5, TRUE, TRUE, 15000000) ON CONFLICT (id) DO NOTHING'
    );
    logger.info('✅ Configurações padrão criadas');
  }

  logger.info('🎉 Seed concluído com sucesso!');
  if (!process.env.SEED_ADMIN_PASSWORD && !process.env.SEED_DEFAULT_PASSWORD) {
    logger.info('📋 Usuários criados com senhas padrão. Defina SEED_*_PASSWORD nas env vars para personalizar.');
  }
}

if (process.argv[1] && process.argv[1].includes('seed')) {
  runSeed().catch((err) => logger.error('Seed failed', { error: err instanceof Error ? err.message : err }));
}