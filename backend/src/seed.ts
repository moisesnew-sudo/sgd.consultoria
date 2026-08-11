import bcrypt from 'bcryptjs';
import { get, run, all } from './database.js';
import { logger } from './lib/logger.js';
import { DEMAND_STATUSES } from './types.js';

const isProduction = process.env.NODE_ENV === 'production';

/** Senhas proibidas mesmo se definidas via env var (nunca usar em seed). */
const BLOCKED_SEED_PASSWORDS = new Set<string>([
  'sgd@2026!',
  'admin2026!',
  'senha123',
  'senha@123',
  'password',
  'password1',
  'admin',
  'admin123',
  'changeme',
  '12345678',
  'trocar-depois',
]);

const MIN_SEED_PASSWORD_LENGTH = 12;

/** true somente se a senha atende aos requisitos mínimos de robustez. */
function isStrongSeedPassword(password: string): boolean {
  if (password.length < MIN_SEED_PASSWORD_LENGTH) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  if (BLOCKED_SEED_PASSWORDS.has(password.toLowerCase())) return false;
  return true;
}

/**
 * Resolve a senha de um usuário seedado.
 * Em produção a env var é obrigatória e precisa ser forte; fora de produção
 * há um fallback de conveniência (nunca reutilizando 'Sgd@2026!').
 */
function resolveSeedPassword(envVar: string, label: string): string {
  const value = process.env[envVar];
  if (isProduction) {
    if (!value) {
      throw new Error(`Seed: a variável de ambiente ${envVar} é obrigatória em produção (usuário ${label}). Defina-a antes de iniciar o servidor.`);
    }
    if (!isStrongSeedPassword(value)) {
      throw new Error(`Seed: a variável ${envVar} (usuário ${label}) não atende aos requisitos mínimos: mínimo de ${MIN_SEED_PASSWORD_LENGTH} caracteres, com letra maiúscula, letra minúscula, número, caractere especial e sem usar senha comum/bloqueada.`);
    }
    return value;
  }
  return value || process.env.SEED_DEFAULT_PASSWORD || `Dev-${label}-Local#1`;
}

export async function runSeed() {
  logger.info('🌱 Verificando dados iniciais...');

  const adminPassword = await bcrypt.hash(resolveSeedPassword('SEED_ADMIN_PASSWORD', 'Admin'), 10);
  const existingAdmin = await get('SELECT id FROM users WHERE email = $1', ['admin@sgd.gov.br']);

  if (!existingAdmin) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['admin@sgd.gov.br', adminPassword, 'Administrador SGD', 'admin']
    );
    logger.info('✅ Usuário admin criado: admin@sgd.gov.br');
  }

  const viewerPassword = await bcrypt.hash(resolveSeedPassword('SEED_VIEWER_PASSWORD', 'Viewer'), 10);
  const existingViewer = await get('SELECT id FROM users WHERE email = $1', ['consulta@sgd.gov.br']);

  if (!existingViewer) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['consulta@sgd.gov.br', viewerPassword, 'Consultor Público', 'consulta']
    );
    logger.info('✅ Usuário consulta criado: consulta@sgd.gov.br');
  }

  const gestorPassword = await bcrypt.hash(resolveSeedPassword('SEED_GESTOR_PASSWORD', 'Gestor'), 10);
  const existingGestor = await get('SELECT id FROM users WHERE email = $1', ['gestor@sgd.gov.br']);

  if (!existingGestor) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['gestor@sgd.gov.br', gestorPassword, 'Gestor SGD', 'gestor']
    );
    logger.info('✅ Usuário gestor criado: gestor@sgd.gov.br');
  }

  const analistaPassword = await bcrypt.hash(resolveSeedPassword('SEED_ANALISTA_PASSWORD', 'Analista'), 10);
  const existingAnalista = await get('SELECT id FROM users WHERE email = $1', ['analista@sgd.gov.br']);

  if (!existingAnalista) {
    await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
      ['analista@sgd.gov.br', analistaPassword, 'Analista SGD', 'analista']
    );
    logger.info('✅ Usuário analista criado: analista@sgd.gov.br');
  }

  const municipalities = [
    { name: 'SOBRAL', uf: 'CE', schools_count: 52, population: 210000, hdi: 0.788, region: 'Nordeste' },
    { name: 'PETROLINA', uf: 'PE', schools_count: 48, population: 350000, hdi: 0.702, region: 'Nordeste' },
    { name: 'OURO PRETO', uf: 'MG', schools_count: 24, population: 74000, hdi: 0.741, region: 'Sudeste' },
    { name: 'RIBEIRÃO PRETO', uf: 'SP', schools_count: 95, population: 710000, hdi: 0.800, region: 'Sudeste' },
    { name: 'PARINTINS', uf: 'AM', schools_count: 35, population: 115000, hdi: 0.658, region: 'Norte' },
    { name: 'CAXIAS DO SUL', uf: 'RS', schools_count: 82, population: 510000, hdi: 0.782, region: 'Sul' },
    { name: 'JUAZEIRO DO NORTE', uf: 'CE', schools_count: 40, population: 275000, hdi: 0.694, region: 'Nordeste' },
    { name: 'PALMAS', uf: 'TO', schools_count: 44, population: 300000, hdi: 0.788, region: 'Norte' },
    { name: 'TRÊS LAGOAS', uf: 'MS', schools_count: 19, population: 125000, hdi: 0.750, region: 'Centro-Oeste' },
    { name: 'GOIÂNIA', uf: 'GO', schools_count: 120, population: 1500000, hdi: 0.799, region: 'Centro-Oeste' }
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
    { key: 'integrations.view', name: 'Integrações - Visualizar', category: 'Integrações', description: 'Visualizar painel de integrações e eventos' },
    { key: 'integrations.manage', name: 'Integrações - Gerenciar', category: 'Integrações', description: 'Gerenciar sistemas de integração' },
    { key: 'integrations.sync', name: 'Integrações - Sincronizar', category: 'Integrações', description: 'Executar sincronização manual com sistemas externos' },
    { key: 'integrations.admin', name: 'Integrações - Operar', category: 'Integrações', description: 'Operar integrações: overview, sincronização, teste de conexão e acompanhamento operacional' },
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
    'audit.view', 'sessions.view', 'backups.view', 'monitoring.view', 'lgpd.view',
    'integrations.view'
  ].filter(k => permMap[k]).map(k => permMap[k]);
  const analistaPerms = [
    'dashboard.view', 'demands.view', 'demands.create', 'demands.edit',
    'demands.export_excel', 'demands.export_pdf',
    'reports.view', 'reports.emit', 'reports.export'
  ].filter(k => permMap[k]).map(k => permMap[k]);
  const consultaPerms = [
    'dashboard.view', 'demands.view',
    'reports.view', 'reports.emit', 'reports.export'
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
    { email: 'diretor@sgd.gov.br', password: resolveSeedPassword('SEED_DIRETOR_PASSWORD', 'Diretor'), name: 'Diretor SGD', role: 'diretor' },
    { email: 'tecnico@sgd.gov.br', password: resolveSeedPassword('SEED_TECNICO_PASSWORD', 'Tecnico'), name: 'Técnico SGD', role: 'tecnico' },
    { email: 'parceiro@sgd.gov.br', password: resolveSeedPassword('SEED_PARCEIRO_PASSWORD', 'Parceiro'), name: 'Parceiro SGD', role: 'parceiro' },
    { email: 'cliente@sgd.gov.br', password: resolveSeedPassword('SEED_CLIENTE_PASSWORD', 'Cliente'), name: 'Cliente SGD', role: 'cliente' },
    { email: 'visitante@sgd.gov.br', password: resolveSeedPassword('SEED_VISITANTE_PASSWORD', 'Visitante'), name: 'Visitante', role: 'visitante' },
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
    parceiro: ['dashboard.view', 'demands.view', 'reports.view', 'reports.emit', 'reports.export'].filter(k => permMap[k]).map(k => permMap[k]),
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

  // Reconciliação idempotente: o seed é a fonte de verdade dos perfis.
  // Revoga grants de role que deixaram de existir no seed (ex.: 'integrations.admin'
  // removida do perfil gestor) e os respetivos grants materializados em
  // user_permissions — preservando ajustes individuais que não vieram do perfil.
  const allRolePerms: Record<string, number[]> = { ...rolePerms, ...newRolePerms };
  const oldRolePermSets: Record<string, Set<number>> = {};
  for (const role of Object.keys(allRolePerms)) {
    const rows = await all<{ permission_id: number }>(
      'SELECT permission_id FROM role_permissions WHERE role = $1', [role]
    );
    oldRolePermSets[role] = new Set(rows.map(r => r.permission_id));
    await run(
      'DELETE FROM role_permissions WHERE role = $1 AND NOT (permission_id = ANY($2::int[]))',
      [role, allRolePerms[role]]
    );
  }
  for (const [role, oldSet] of Object.entries(oldRolePermSets)) {
    const removed = [...oldSet].filter(id => !allRolePerms[role].includes(id));
    if (removed.length > 0) {
      await run(
        `DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE role = $1) AND permission_id = ANY($2::int[])`,
        [role, removed]
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

  // Seed do cadastro mestre de órgãos (CAIXA ALTA, sem duplicidades).
  const BASE_ORGANS = [
    'MEC', 'FNDE', 'MEC/FNDE', 'MINISTÉRIO DA SAÚDE', 'MS', 'MAPA',
    'MINISTÉRIO DA AGRICULTURA E PECUÁRIA', 'SECRETARIA MUNICIPAL DE EDUCAÇÃO',
    'SECRETARIA ESTADUAL DE EDUCAÇÃO', 'CAIXA ECONÔMICA FEDERAL', 'BNDES',
    'CONSELHO MUNICIPAL DE EDUCAÇÃO'
  ];
  const existingOrgans = await all<{ organ: string }>(
    `SELECT DISTINCT organ FROM demands WHERE organ IS NOT NULL AND TRIM(organ) <> ''`
  );
  const organNames = [
    ...BASE_ORGANS,
    ...existingOrgans.map(o => o.organ.toUpperCase().trim()),
  ].filter((n, i, arr) => n && arr.findIndex(x => x === n) === i);

  let organCount = 0;
  for (const name of organNames) {
    const exists = await get('SELECT id FROM organs WHERE UPPER(name) = $1', [name]);
    if (!exists) {
      await run('INSERT INTO organs (name) VALUES ($1)', [name]);
      organCount++;
    }
  }
  if (organCount > 0) {
    logger.info(`✅ ${organCount} órgãos do cadastro mestre criados`);
  }

  // Seed dos sistemas de integração (referência para webhooks e mapeamento de status).
  // Os segredos NÃO são seedados: secret_env_key aponta para a variável de ambiente.
  const INTEGRATION_SYSTEMS = [
    { code: 'transferegov', name: 'Transferegov', secret_env_key: 'TRANSFEREGOV_WEBHOOK_SECRET' },
    { code: 'sei', name: 'SEI', secret_env_key: 'SEI_WEBHOOK_SECRET' },
    { code: 'cglog', name: 'CGLOG', secret_env_key: 'CGLOG_WEBHOOK_SECRET' },
  ];
  for (const s of INTEGRATION_SYSTEMS) {
    await run(
      'INSERT INTO integration_systems (code, name, secret_env_key) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING',
      [s.code, s.name, s.secret_env_key]
    );
  }

  // Seed do mapeamento de status externo -> status interno do SGD.
  // Somente status existentes no enum do SGD (types.ts) são criados.
  const STATUS_MAPPINGS = [
    { system: 'transferegov', external: 'APROVADO', internal: 'concluido', description: 'Mapeia o status APROVADO do Transferegov para concluido no SGD (proposta aprovada)' },
    { system: 'transferegov', external: 'EM_ANALISE', internal: 'analise', description: 'Mapeia o status EM_ANALISE do Transferegov para analise no SGD (proposta em análise)' },
    { system: 'transferegov', external: 'PENDENTE', internal: 'pendente', description: 'Mapeia o status PENDENTE do Transferegov para pendente no SGD (proposta pendente)' },
    { system: 'transferegov', external: 'CANCELADO', internal: 'rejeitado', description: 'Mapeia o status CANCELADO do Transferegov para rejeitado no SGD (proposta cancelada)' },
    { system: 'sei', external: 'TRAMITANDO', internal: 'analise', description: 'Mapeia o status TRAMITANDO do SEI para analise no SGD (processo em trâmite)' },
    { system: 'sei', external: 'FINALIZADO', internal: 'concluido', description: 'Mapeia o status FINALIZADO do SEI para concluido no SGD (processo finalizado)' },
    { system: 'cglog', external: 'EM_ANALISE', internal: 'analise', description: 'Mapeia o status EM_ANALISE do CGLOG para analise no SGD (em análise)' },
    { system: 'cglog', external: 'CONCLUIDO', internal: 'concluido', description: 'Mapeia o status CONCLUIDO do CGLOG para concluido no SGD (concluído)' },
    { system: 'cglog', external: 'CANCELADO', internal: 'rejeitado', description: 'Mapeia o status CANCELADO do CGLOG para rejeitado no SGD (cancelado)' },
  ];

  const validInternalStatuses = new Set<string>(DEMAND_STATUSES);
  let mappingCount = 0;
  for (const m of STATUS_MAPPINGS) {
    if (!validInternalStatuses.has(m.internal)) {
      logger.warn(`⚠️  Mapeamento ignorado (status interno inválido): ${m.system} ${m.external} -> ${m.internal}`);
      continue;
    }
    const system = await get<{ id: number }>('SELECT id FROM integration_systems WHERE code = $1', [m.system]);
    if (!system) {
      logger.warn(`⚠️  Mapeamento ignorado (sistema não encontrado): ${m.system}`);
      continue;
    }
    await run(
      `INSERT INTO integration_status_mapping (system_id, external_status, internal_status, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (system_id, external_status)
       DO UPDATE SET internal_status = EXCLUDED.internal_status, description = EXCLUDED.description, active = TRUE, updated_at = NOW()`,
      [system.id, m.external, m.internal, m.description]
    );
    mappingCount++;
  }
  if (mappingCount > 0) {
    logger.info(`✅ ${mappingCount} mapeamentos de status de integração sincronizados`);
  }

  logger.info('🎉 Seed concluído com sucesso!');
  if (!process.env.SEED_ADMIN_PASSWORD && !process.env.SEED_DEFAULT_PASSWORD) {
    logger.info('📋 Usuários criados com senhas padrão. Defina SEED_*_PASSWORD nas env vars para personalizar.');
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  runSeed().catch((err) => logger.error('Seed failed', { error: err instanceof Error ? err.message : err }));
}