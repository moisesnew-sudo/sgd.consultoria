import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { get, run, all, transaction } from '../database.js';
import { UserResponse, USER_ROLES } from '../types.js';
import { authenticateToken, authenticateRefreshToken, requirePermission, signAccessToken, signRefreshToken } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

const PASSWORD_HISTORY_LIMIT = 5;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const passwordSchema = z.string()
  .min(8, 'Senha deve ter pelo menos 8 caracteres')
  .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
  .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
  .regex(/[0-9]/, 'Senha deve conter pelo menos um número')
  .regex(/[^A-Za-z0-9]/, 'Senha deve conter pelo menos um caractere especial');

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Senha é obrigatória')
});

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: passwordSchema,
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(100),
  role: z.enum(USER_ROLES).optional()
});

async function isAccountLocked(email: string): Promise<boolean> {
  const recent = await get<{ count: string }>(
    `SELECT COUNT(*) as count FROM login_attempts
     WHERE email = $1 AND success = FALSE AND attempted_at > NOW() - $2 * INTERVAL '1 minute'`,
    [email, LOCKOUT_MINUTES]
  );
  return parseInt(recent?.count || '0') >= MAX_LOGIN_ATTEMPTS;
}

async function endUserSessions(userId: number, excludeTokenHash?: string) {
  if (excludeTokenHash) {
    await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1 AND token_hash != $2', [userId, excludeTokenHash]);
  } else {
    await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1', [userId]);
  }
}

async function savePasswordHistory(userId: number, passwordHash: string) {
  await run('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [userId, passwordHash]);
  await run(
    `DELETE FROM password_history WHERE id IN (
      SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2
    )`, [userId, PASSWORD_HISTORY_LIMIT]
  );
}

// ✅ CORREÇÃO: Recebe texto puro, compara com bcrypt corretamente
async function wasPasswordUsed(userId: number, plainPassword: string): Promise<boolean> {
  const history = await all<{ password_hash: string }>(
    'SELECT password_hash FROM password_history WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  for (const h of history) {
    if (await bcrypt.compare(plainPassword, h.password_hash)) {
      return true;
    }
  }
  return false;
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const { ip_address, user_agent } = extractMeta(req);
    const user = await get('SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);

    if (user && await isAccountLocked(email)) {
      await logAudit({
        entity_type: 'auth', entity_id: email, action: 'login_locked',
        user_name: email, details: { ip: ip_address }, ip_address, user_agent
      });
      return res.status(429).json({ error: 'Conta temporariamente bloqueada por muitas tentativas. Tente novamente em 15 minutos.' });
    }

    if (!user || user.active === false || !(await bcrypt.compare(password, user.password_hash))) {
      await run('INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, FALSE)', [email, ip_address]);
      await logAudit({
        entity_type: 'auth', entity_id: email, action: 'login_failed',
        user_name: email, details: { ip: ip_address }, ip_address, user_agent
      });
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    await run('INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, TRUE)', [email, ip_address]);

    let permissions: string[] = [];
    if (user.role === 'admin') {
      const allPerms = await all<{ key: string }>('SELECT key FROM permissions');
      permissions = allPerms.map(p => p.key);
    } else {
      const userPerms = await all<{ key: string }>(
        `SELECT p.key FROM user_permissions up
         JOIN permissions p ON p.id = up.permission_id
         WHERE up.user_id = $1 AND up.granted = TRUE`, [user.id]
      );
      permissions = userPerms.map(p => p.key);
    }

    const userResponse: UserResponse = {
      id: user.id, email: user.email, name: user.name, role: user.role, permissions
    };

    const accessToken = signAccessToken(user);
    const refreshFamily = crypto.randomBytes(16).toString('hex');
    const refreshToken = signRefreshToken(user.id, refreshFamily);
    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const accessHash = crypto.createHash('sha256').update(accessToken).digest('hex');

    let browser = 'Desconhecido', os = 'Desconhecido';
    const ua = user_agent || '';
    if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    if (ua.includes('Windows NT')) os = 'Windows';
    else if (ua.includes('Mac OS X')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    await run(
      `INSERT INTO active_sessions (user_id, token_hash, ip_address, user_agent, browser, os)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [user.id, accessHash, ip_address, user_agent, browser, os]
    );

    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await run(
      'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at) VALUES ($1, $2, $3, $4)',
      [user.id, refreshHash, refreshFamily, refreshExpiry]
    );

    await logAudit({
      entity_type: 'auth', entity_id: String(user.id), action: 'login',
      user_id: user.id, user_name: user.name,
      details: { ip: ip_address, browser, os }, ip_address, user_agent
    });

    res.json({ token: accessToken, refreshToken, user: userResponse, session: { browser, os, ip: ip_address } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    logger.error('Login error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/refresh', authenticateRefreshToken, async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const oldRefreshToken = req.body.refreshToken;
    const oldHash = crypto.createHash('sha256').update(oldRefreshToken).digest('hex');

    const user = await get('SELECT * FROM users WHERE id = $1 AND active = TRUE AND deleted_at IS NULL', [req.user!.id]);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user.id, req.refreshFamily!);
    const newRefreshHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');

    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await run(
      'INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, replaced_by) VALUES ($1, $2, $3, $4, $5)',
      [user.id, newRefreshHash, req.refreshFamily!, refreshExpiry, null]
    );
    await run('UPDATE refresh_tokens SET revoked = TRUE, replaced_by = $1 WHERE token_hash = $2', [newRefreshHash, oldHash]);

    await logAudit({
      entity_type: 'auth', entity_id: String(user.id), action: 'token_refresh',
      user_id: user.id, user_name: user.name, details: { ip: ip_address }, ip_address, user_agent
    });

    res.json({ token: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    logger.error('Refresh error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao renovar token' });
  }
});

router.post('/logout', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const authHeader = req.headers['authorization'];
    const token = authHeader?.split(' ')[1];
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const decoded = jwt.decode(token) as { exp?: number };
      const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 86400000);
      await run(
        'INSERT INTO token_blacklist (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [tokenHash, expiresAt]
      );
      await run('UPDATE active_sessions SET active = FALSE WHERE token_hash = $1', [tokenHash]);
    }
    const { refreshToken } = req.body;
    if (refreshToken) {
      const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await run('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [refreshHash]);
    }
    await logAudit({
      entity_type: 'auth', entity_id: String(req.user!.id), action: 'logout',
      user_id: req.user!.id, user_name: req.user!.name, details: {}, ip_address, user_agent
    });
    res.json({ message: 'Sessão encerrada com sucesso' });
  } catch (error) {
    logger.error('Logout error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/register', authenticateToken, requirePermission('users.create'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }
    const { ip_address, user_agent } = extractMeta(req);
    const { email, password, name, role } = registerSchema.parse(req.body);
    const existingUser = await get('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role',
      [email, passwordHash, name, role || 'consulta']
    );
    const registerUserId = result.rows[0].id;
    const registerRole = result.rows[0].role;
    const registerRolePerms = await all<{ permission_id: number }>(
      'SELECT permission_id FROM role_permissions WHERE role = $1', [registerRole]
    );
    for (const rp of registerRolePerms) {
      await run(
        'INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING',
        [registerUserId, rp.permission_id]
      );
    }
    await savePasswordHistory(registerUserId, passwordHash);
    await logAudit({
      entity_type: 'user', entity_id: String(registerUserId), action: 'create',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { target_email: email, target_role: registerRole }, ip_address, user_agent
    });
    res.status(201).json({ message: 'Usuário criado com sucesso', user: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    logger.error('Register error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const user = await get(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id]
  );
  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }
  let permissions: string[] = [];
  if (user.role === 'admin') {
    const allPerms = await all<{ key: string }>('SELECT key FROM permissions');
    permissions = allPerms.map(p => p.key);
  } else {
    const userPerms = await all<{ key: string }>(
      `SELECT p.key FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = $1 AND up.granted = TRUE`, [user.id]
    );
    permissions = userPerms.map(p => p.key);
  }
  res.json({ ...user, permissions });
});

// ✅ CORREÇÃO: Troca de senha em transação atômica
router.put('/change-password', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const currentPassword = req.body.currentPassword || req.body.current_password;
    const newPassword = req.body.newPassword || req.body.new_password;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const user = await get('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }
    // ✅ CORREÇÃO: Passa texto puro
    const reused = await wasPasswordUsed(req.user!.id, newPassword);
    if (reused) {
      return res.status(400).json({ error: 'A nova senha não pode ser igual a nenhuma das últimas 5 senhas utilizadas.' });
    }
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newPasswordHash, req.user!.id]);
      await client.query('INSERT INTO password_history (user_id, password_hash) VALUES ($1, $2)', [req.user!.id, newPasswordHash]);
      await client.query(
        'DELETE FROM password_history WHERE id IN (SELECT id FROM password_history WHERE user_id = $1 ORDER BY created_at DESC OFFSET $2)',
        [req.user!.id, PASSWORD_HISTORY_LIMIT]
      );
      await client.query('UPDATE active_sessions SET active = FALSE WHERE user_id = $1 AND active = TRUE', [req.user!.id]);
    });

    await logAudit({
      entity_type: 'auth', entity_id: String(req.user!.id), action: 'password_change',
      user_id: req.user!.id, user_name: req.user!.name, details: {}, ip_address, user_agent
    });
    res.json({ message: 'Senha alterada com sucesso. Todas as sessões foram encerradas.' });
  } catch (error) {
    logger.error('Change password error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/users', authenticateToken, requirePermission('users.view'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador' && req.user?.role !== 'gestor' && req.user?.role !== 'diretor') {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    const users = await all(
      'SELECT id, email, name, role, active, created_at, deleted_at FROM users WHERE deleted_at IS NULL ORDER BY name'
    );
    res.json(users);
  } catch (error) {
    logger.error('List users error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

router.post('/users', authenticateToken, requirePermission('users.create'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }
    const { ip_address, user_agent } = extractMeta(req);
    const { email, password, name, role } = registerSchema.parse(req.body);
    const existingUser = await get('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, active',
      [email, passwordHash, name, role || 'consulta']
    );
    const newUserId = result.rows[0].id;
    const newRole = result.rows[0].role;
    const rolePerms = await all<{ permission_id: number }>(
      'SELECT permission_id FROM role_permissions WHERE role = $1', [newRole]
    );
    for (const rp of rolePerms) {
      await run(
        'INSERT INTO user_permissions (user_id, permission_id, granted) VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING',
        [newUserId, rp.permission_id]
      );
    }
    await savePasswordHistory(newUserId, passwordHash);
    await logAudit({
      entity_type: 'user', entity_id: String(newUserId), action: 'create',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { target_email: email, target_role: newRole }, ip_address, user_agent
    });
    res.status(201).json({ message: 'Usuário criado com sucesso', user: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    logger.error('Create user error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

const updateUserSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional()
});

router.put('/users/:id', authenticateToken, requirePermission('users.edit'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador') {
      return res.status(403).json({ error: 'Apenas administradores podem editar usuários' });
    }
    const { ip_address, user_agent } = extractMeta(req);
    const id = parseInt(req.params.id as string);
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível alterar a própria conta' });
    }
    const data = updateUserSchema.parse(req.body);
    const existing = await get('SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if ((existing.role === 'admin' || existing.role === 'administrador') && data.role && data.role !== 'admin' && data.role !== 'administrador') {
      const adminCount = await get<{ count: string }>(
        "SELECT COUNT(*) as count FROM users WHERE (role = 'admin' OR role = 'administrador') AND active = TRUE AND deleted_at IS NULL"
      );
      if (parseInt(adminCount?.count || '0') <= 1) {
        return res.status(400).json({ error: 'Deve haver ao menos um administrador ativo' });
      }
    }
    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;
    if (data.role) { updates.push(`role = $${idx++}`); values.push(data.role); }
    if (data.active !== undefined) { updates.push(`active = $${idx++}`); values.push(data.active); }
    if (data.name) { updates.push(`name = $${idx++}`); values.push(data.name); }
    if (data.email) {
      const emailExists = await get('SELECT id FROM users WHERE email = $1 AND id != $2 AND deleted_at IS NULL', [data.email, id]);
      if (emailExists) return res.status(409).json({ error: 'Email já cadastrado' });
      updates.push(`email = $${idx++}`); values.push(data.email);
    }
    updates.push('updated_at = NOW()');
    values.push(id);
    await run(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);

    if (data.active === false) {
      await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1', [id]);
    }

    const updated = await get('SELECT id, email, name, role, active FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    await logAudit({
      entity_type: 'user', entity_id: String(id), action: 'update',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { changes: data }, ip_address, user_agent
    });
    res.json({ message: 'Usuário atualizado', user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    logger.error('Update user error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

router.delete('/users/:id', authenticateToken, requirePermission('users.delete'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador') {
      return res.status(403).json({ error: 'Apenas administradores podem excluir usuários' });
    }
    const { ip_address, user_agent } = extractMeta(req);
    const id = parseInt(req.params.id as string);
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível excluir a própria conta' });
    }
    const existing = await get('SELECT id, role FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });
    await run('UPDATE users SET deleted_at = NOW(), active = FALSE WHERE id = $1', [id]);
    await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1', [id]);
    await logAudit({
      entity_type: 'user', entity_id: String(id), action: 'delete',
      user_id: req.user!.id, user_name: req.user!.name, details: {}, ip_address, user_agent
    });
    res.json({ message: 'Usuário excluído com sucesso' });
  } catch (error) {
    logger.error('Delete user error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao excluir usuário' });
  }
});

router.put('/users/:id/password', authenticateToken, requirePermission('users.edit'), async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'administrador') {
      return res.status(403).json({ error: 'Apenas administradores podem alterar senhas' });
    }
    const { ip_address, user_agent } = extractMeta(req);
    const id = parseInt(req.params.id as string);
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Use a troca de senha do próprio perfil' });
    }
    const { newPassword } = z.object({ newPassword: z.string().min(6).max(100) }).parse(req.body);
    const existing = await get('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!existing) return res.status(404).json({ error: 'Usuário não encontrado' });
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await run('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, id]);
    await savePasswordHistory(id, passwordHash);
    await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1', [id]);
    await logAudit({
      entity_type: 'user', entity_id: String(id), action: 'password_reset',
      user_id: req.user!.id, user_name: req.user!.name, details: {}, ip_address, user_agent
    });
    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
    logger.error('Reset password error', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Erro ao alterar senha' });
  }
});

export default router;
