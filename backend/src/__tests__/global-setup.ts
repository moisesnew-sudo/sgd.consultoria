import { initDatabase, run } from '../database.js';
import { runSeed } from '../seed.js';

export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sgd';

  await initDatabase();
  await runSeed();

  await run('DELETE FROM login_attempts');
  await run('DELETE FROM active_sessions');
  await run('DELETE FROM token_blacklist');
  await run('DELETE FROM password_reset_tokens');
}
