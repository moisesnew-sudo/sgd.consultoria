import { beforeAll } from 'vitest';
import { run } from '../database.js';

beforeAll(async () => {
  await run('DELETE FROM login_attempts');
  await run('DELETE FROM active_sessions');
  await run('DELETE FROM token_blacklist');
  await run('DELETE FROM password_reset_tokens');
});
