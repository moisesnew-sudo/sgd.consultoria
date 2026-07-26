import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { get, run } from '../database.js';
import { logAudit, extractMeta } from '../lib/audit.js';

const router = Router();

const requestResetSchema = z.object({
  email: z.string().email('Email inválido')
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token é obrigatório'),
  password: z.string()
    .min(8, 'Senha deve ter pelo menos 8 caracteres')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número')
    .regex(/[^A-Za-z0-9]/, 'Senha deve conter pelo menos um caractere especial')
});

router.post('/request', async (req: Request, res: Response) => {
  const { ip_address, user_agent } = extractMeta(req);
  try {
    const { email } = requestResetSchema.parse(req.body);
    const user = await get<{ id: number; name: string }>('SELECT id, name FROM users WHERE email = $1', [email]);

    const response = { message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.' };

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await run(
        'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 minutes\')',
        [user.id, tokenHash]
      );

      const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`;
      console.log(`\n[PASSWORD RESET] Link para ${email}: ${resetLink}\n`);

      await logAudit({
        entity_type: 'auth', entity_id: String(user.id), action: 'password_reset_requested',
        user_id: user.id, user_name: user.name,
        details: {}, ip_address, user_agent
      });
    }

    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Email inválido' });
    }
    console.error('Password reset request error:', error);
    res.json({ message: 'Se o email estiver cadastrado, você receberá um link para redefinir sua senha.' });
  }
});

router.post('/reset', async (req: Request, res: Response) => {
  const { ip_address, user_agent } = extractMeta(req);
  try {
    const { token, password } = resetPasswordSchema.parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetToken = await get<{ id: number; user_id: number; used: boolean }>(
      `SELECT id, user_id, used FROM password_reset_tokens
       WHERE token_hash = $1 AND expires_at > NOW() AND used = FALSE`,
      [tokenHash]
    );

    if (!resetToken) {
      return res.status(400).json({ error: 'Token inválido ou expirado' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await run('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, resetToken.user_id]);
    await run('UPDATE password_reset_tokens SET used = TRUE WHERE id = $1', [resetToken.id]);
    await run('UPDATE active_sessions SET active = FALSE WHERE user_id = $1', [resetToken.user_id]);

    await logAudit({
      entity_type: 'auth', entity_id: String(resetToken.user_id), action: 'password_reset_completed',
      user_id: resetToken.user_id,
      details: {}, ip_address, user_agent
    });

    res.json({ message: 'Senha redefinida com sucesso. Todas as sessões foram encerradas.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors[0].message });
    }
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

export default router;
