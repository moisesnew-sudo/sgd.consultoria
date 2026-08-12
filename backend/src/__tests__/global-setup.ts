import bcrypt from 'bcryptjs';
import { initDatabase, run, pool } from '../database.js';
import { runSeed } from '../seed.js';

/**
 * Credenciais dos usuários semeados que os testes usam para login.
 *
 * Fonte da verdade do ambiente de teste: os mesmos valores que helpers.ts
 * (admin/gestor) e os testes de auth/audit usam para analista. O seed,
 * fora de produção, cai no fallback 'Dev-*-Local#1' quando SEED_*_PASSWORD
 * não está definida — o que fazia os testes quebrarem em banco novo (CI)
 * com 401/429. Aqui definimos explicitamente no contexto de teste.
 */
const TEST_SEED_CREDENTIALS = [
  { email: 'admin@sgd.gov.br', password: 'Admin2026!', envVar: 'SEED_ADMIN_PASSWORD' },
  { email: 'gestor@sgd.gov.br', password: 'Gestor2026!', envVar: 'SEED_GESTOR_PASSWORD' },
  { email: 'analista@sgd.gov.br', password: 'Analista2026!', envVar: 'SEED_ANALISTA_PASSWORD' },
];

export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

  // Secrets dos sistemas semeados (Fase 3.1 P9): secretConfigured agora valida o env.
  process.env.TRANSFEREGOV_WEBHOOK_SECRET = process.env.TRANSFEREGOV_WEBHOOK_SECRET || 'test-transferegov-secret';
  process.env.SEI_WEBHOOK_SECRET = process.env.SEI_WEBHOOK_SECRET || 'test-sei-secret';
  process.env.CGLOG_WEBHOOK_SECRET = process.env.CGLOG_WEBHOOK_SECRET || 'test-cglog-secret';

  // As senhas de seed só são definidas aqui (contexto de teste). Em produção
  // continuam obrigatórias e validadas pelo seed via env vars reais.
  for (const cred of TEST_SEED_CREDENTIALS) {
    process.env[cred.envVar] = cred.password;
  }

  await initDatabase();
  await runSeed();

  // Realinha de forma idempotente as senhas dos usuários semeados usados pelos
  // testes. Em banco novo o seed já cria com as senhas acima; em banco que já
  // tinha dados (ex.: desenvolvimento), garante determinismo nos logins.
  for (const cred of TEST_SEED_CREDENTIALS) {
    const hash = await bcrypt.hash(cred.password, 10);
    await run('UPDATE users SET password_hash = $2 WHERE email = $1', [cred.email, hash]);
  }

  await run('DELETE FROM login_attempts');
  await run('DELETE FROM active_sessions');
  await run('DELETE FROM token_blacklist');
  await run('DELETE FROM password_reset_tokens');
}

export async function teardown() {
  await pool.end();
}
