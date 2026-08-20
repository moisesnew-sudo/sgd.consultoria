import { createTransport, Transporter, SentMessageInfo } from 'nodemailer';
import { logger } from './logger.js';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  enabled: boolean;
}

export interface PasswordResetEmailData {
  email: string;
  token: string;
  frontendUrl: string;
  expiresMinutes: number;
}

let transporter: Transporter | null = null;
let config: EmailConfig | null = null;

function loadConfig(): EmailConfig {
  if (config) return config;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'SGD <noreply@sgd.gov.br>';
  const enabled = process.env.EMAIL_ENABLED !== 'false';

  if (!host || !user || !pass) {
    logger.warn('Email service not fully configured — emails will be logged only', {
      hasHost: !!host,
      hasUser: !!user,
      hasPass: !!pass,
      enabled,
    });
  }

  config = { host: host || '', port, secure: port === 465, user: user || '', pass: pass || '', from, enabled };
  return config;
}

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.host || !cfg.user || !cfg.pass) {
    return null;
  }

  transporter = createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  });

  return transporter;
}

function buildResetLink(frontendUrl: string, token: string): string {
  const base = frontendUrl.replace(/\/+$/, '');
  return `${base}/reset-password?token=${token}`;
}

function buildTextEmail(data: PasswordResetEmailData): string {
  const link = buildResetLink(data.frontendUrl, data.token);
  return `
Recuperação de Senha — SGD

Olá,

Você solicitou a redefinição de sua senha no Sistema de Gestão de Demandas (SGD).

Para criar uma nova senha, acesse o link abaixo (válido por ${data.expiresMinutes} minutos):

${link}

Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual permanecerá inalterada.

Para sua segurança, este link expira em ${data.expiresMinutes} minutos e pode ser usado apenas uma vez.

---
Sistema de Gestão de Demandas (SGD)
Coordenação Geral de Articulação e Supervisão Institucional
Secretaria Executiva — MAPA
`.trim();
}

function buildHtmlEmail(data: PasswordResetEmailData): string {
  const link = buildResetLink(data.frontendUrl, data.token);
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recuperação de Senha — SGD</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
    <tr>
      <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2c5282 100%); padding: 32px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700;">Recuperação de Senha</h1>
        <p style="margin: 8px 0 0; color: #bfdbfe; font-size: 14px;">Sistema de Gestão de Demandas (SGD)</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <p style="margin: 0 0 16px; color: #1f2937; font-size: 16px; line-height: 1.6;">Olá,</p>
        <p style="margin: 0 0 24px; color: #4b5563; font-size: 15px; line-height: 1.6;">Você solicitou a redefinição de sua senha no <strong>Sistema de Gestão de Demandas (SGD)</strong>.</p>
        <p style="margin: 0 0 8px; color: #4b5563; font-size: 15px; line-height: 1.6;">Para criar uma nova senha, clique no botão abaixo (válido por <strong>${data.expiresMinutes} minutos</strong>):</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="display: inline-block; background: #1e3a5f; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Redefinir Senha</a>
        </div>
        <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Ou copie e cole este link no navegador:</p>
        <p style="margin: 0 0 24px; padding: 12px; background: #f3f4f6; border-radius: 6px; color: #1e3a5f; font-size: 13px; word-break: break-all; font-family: monospace;">${link}</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="margin: 0 0 8px; color: #6b7280; font-size: 13px; line-height: 1.5;">Se você não solicitou esta alteração, ignore este e-mail. Sua senha atual permanecerá inalterada.</p>
        <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.5;">Para sua segurança, este link expira em <strong>${data.expiresMinutes} minutos</strong> e pode ser usado apenas uma vez.</p>
      </td>
    </tr>
    <tr>
      <td style="background: #f9fafb; padding: 24px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">Sistema de Gestão de Demandas (SGD)<br>Coordenação Geral de Articulação e Supervisão Institucional<br>Secretaria Executiva — MAPA</p>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const cfg = loadConfig();

  if (!cfg.enabled) {
    logger.info('Email sending disabled (EMAIL_ENABLED=false) — logging only', { email: data.email });
    return { success: true, messageId: 'disabled' };
  }

  const transport = getTransporter();
  if (!transport) {
    const msg = 'Email service not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS) — email not sent';
    logger.warn(msg, { email: data.email });
    return { success: false, error: msg };
  }

  const text = buildTextEmail(data);
  const html = buildHtmlEmail(data);

  try {
    const info: SentMessageInfo = await transport.sendMail({
      from: cfg.from,
      to: data.email,
      subject: 'Recuperação de Senha — SGD',
      text,
      html,
    });

    logger.info('Password reset email sent', {
      email: data.email,
      messageId: info.messageId,
      previewUrl: info.previewUrl,
    });

    return { success: true, messageId: info.messageId };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Failed to send password reset email', { email: data.email, error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

export function isEmailConfigured(): boolean {
  const cfg = loadConfig();
  return cfg.enabled && !!cfg.host && !!cfg.user && !!cfg.pass;
}

export function resetEmailConfig(): void {
  transporter = null;
  config = null;
}

export default {
  sendPasswordResetEmail,
  isEmailConfigured,
  resetEmailConfig,
};