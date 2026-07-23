import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { get, run, all } from '../database.js';
import { User, UserResponse } from '../types.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres')
});

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter pelo menos 6 caracteres'),
  name: z.string().min(2, 'Nome deve ter pelo menos 2 caracteres'),
  role: z.enum(['admin', 'gestor', 'analista', 'consulta']).optional()
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await get<User>('SELECT * FROM users WHERE email = $1', [email]);

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Usuário desativado. Contate o administrador.' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const userResponse: UserResponse = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };

    const token = jwt.sign(userResponse, process.env.JWT_SECRET!, {
      expiresIn: (process.env.JWT_EXPIRES_IN || '24h') as jwt.SignOptions['expiresIn']
    });

    res.json({ token, user: userResponse });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.post('/register', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }

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

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      user: result.rows[0]
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Register error:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const user = await get<UserResponse>(
    'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
    [req.user!.id]
  );

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  res.json(user);
});

router.put('/change-password', authenticateToken, async (req: Request, res: Response) => {
  try {
    const currentPassword = req.body.currentPassword || req.body.current_password;
    const newPassword = req.body.newPassword || req.body.new_password;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    const user = await get<User>('SELECT * FROM users WHERE id = $1', [req.user!.id]);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    await run(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, req.user!.id]
    );

    res.json({ message: 'Senha alterada com sucesso' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// List users (admin and gestor can view; admin manages)
router.get('/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'gestor') {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    const users = await all<UserResponse & { active: boolean; created_at: string }>(
      'SELECT id, email, name, role, active, created_at FROM users ORDER BY name'
    );
    res.json(users);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// Create user (admin only)
router.post('/users', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem criar usuários' });
    }
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
    res.status(201).json({ message: 'Usuário criado com sucesso', user: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Update user role/active (admin only)
const updateUserSchema = z.object({
  role: z.enum(['admin', 'gestor', 'analista', 'consulta']).optional(),
  active: z.boolean().optional(),
  name: z.string().min(2).optional()
});

router.put('/users/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores podem editar usuários' });
    }
    const id = parseInt(req.params.id as string);
    if (id === req.user!.id) {
      return res.status(400).json({ error: 'Não é possível alterar a própria conta' });
    }
    const data = updateUserSchema.parse(req.body);
    const existing = await get<User>('SELECT id, role FROM users WHERE id = $1', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    if (existing.role === 'admin' && data.role && data.role !== 'admin') {
      const adminCount = await get<{ count: string }>("SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND active = TRUE");
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
    updates.push('updated_at = NOW()');
    values.push(id);
    await run(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    const updated = await get<UserResponse & { active: boolean }>(
      'SELECT id, email, name, role, active FROM users WHERE id = $1', [id]
    );
    res.json({ message: 'Usuário atualizado', user: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Dados inválidos', details: error.errors });
    }
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

export default router;