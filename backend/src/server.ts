import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// ✅ CORREÇÃO: Validação rigorosa de secrets no startup
// ============================================================
function validateEnv() {
  const errors: string[] = [];

  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET não definido');
  } else if (process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET deve ter pelo menos 32 caracteres');
  } else if (process.env.JWT_SECRET === 'undefined' || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'default') {
    errors.push('JWT_SECRET não pode ser um valor padrão/fraco');
  }

  if (!process.env.DATABASE_URL) {
    errors.push('DATABASE_URL não definida');
  }

  if (process.env.NODE_ENV === 'production') {
    const corsOrigin = process.env.CORS_ORIGIN || '';
    if (corsOrigin.includes('*') || corsOrigin.trim() === '') {
      errors.push('CORS_ORIGIN não pode ser "*" ou vazio em produção. Defina domínios específicos.');
    }
  }

  if (errors.length > 0) {
    console.error('❌ ERROS DE CONFIGURAÇÃO CRÍTICOS:');
    errors.forEach(e => console.error(`   - ${e}`));
    process.exit(1);
  }
}

validateEnv();

// Import routes
import authRoutes from './routes/auth.js';
import demandsRoutes from './routes/demands.js';
import municipalitiesRoutes from './routes/municipalities.js';
import settingsRoutes from './routes/settings.js';
import commentsRoutes from './routes/comments.js';
import auditRoutes from './routes/audit.js';
import integrationsRoutes from './routes/integrations.js';
import permissionsRoutes from './routes/permissions.js';
import passwordResetRoutes from './routes/password-reset.js';
import sessionsRoutes from './routes/sessions.js';
import backupsRoutes from './routes/backups.js';
import monitoringRoutes from './routes/monitoring.js';
import lgpdRoutes from './routes/lgpd.js';
import uploadRoutes from './routes/upload.js';
import { runSeed } from './seed.js';
import { initDatabase, run } from './database.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
// ✅ CORREÇÃO: CSP sem 'unsafe-eval' em produção
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: process.env.NODE_ENV === 'production'
    ? ["'self'", 'https://*.googletagmanager.com']
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://*.googletagmanager.com'],
  styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  imgSrc: ["'self'", 'data:', 'https://*.amazonaws.com', 'https://*.gov.br'],
  connectSrc: ["'self'", 'https://api.github.com'],
  frameAncestors: ["'none'"],
  formAction: ["'self'"],
  baseUri: ["'self'"]
};

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives, reportOnly: false },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// Compression
app.use(compression());

// ✅ CORREÇÃO: CORS com validação estrita de origens
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(s => s.length > 0 && s !== '*');

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  console.error('❌ CORS_ORIGIN não configurado corretamente em produção');
  process.exit(1);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  exposedHeaders: ['X-Request-Id']
}));

// ✅ CORREÇÃO: Origin/Referer validation mais robusta
app.use('/api/auth', (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && req.method !== 'GET') {
    const origin = req.headers['origin'] || req.headers['referer'] || '';
    if (typeof origin === 'string' && origin.length > 0) {
      const valid = allowedOrigins.some(o => {
        try {
          const allowedUrl = new URL(o);
          const originUrl = new URL(origin);
          return allowedUrl.hostname === originUrl.hostname;
        } catch {
          return origin.startsWith(o);
        }
      });
      if (!valid) {
        return res.status(403).json({ error: 'Requisição rejeitada: origem inválida' });
      }
    }
  }
  next();
});

// Per-endpoint rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Muitas tentativas de login. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Muitas tentativas de redefinição de senha. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.email || req.ip || 'unknown'
});

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200'),
  message: { error: 'Muitas requisições. Por favor, tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth/login', authLimiter);
app.use('/api/password-reset/request', passwordResetLimiter);
app.use('/api/', apiLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/demands', demandsRoutes);
app.use('/api/demands', commentsRoutes);
app.use('/api/municipalities', municipalitiesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/password-reset', passwordResetRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/lgpd', lgpdRoutes);
app.use('/api', uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production' && process.env.SERVE_FRONTEND === 'true') {
  const frontendPath = path.join(__dirname, '..', '..', 'frontend', 'dist');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(frontendPath, 'index.html'));
    });
  }
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message
  });
});

// Start server
async function start() {
  await initDatabase();
  await runSeed();

  // Cleanup expired/inactive data
  await run("DELETE FROM active_sessions WHERE active = FALSE AND last_activity < NOW() - INTERVAL '24 hours'");
  await run("DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '48 hours'");
  await run("DELETE FROM token_blacklist WHERE expires_at < NOW()");
  await run("DELETE FROM refresh_tokens WHERE expires_at < NOW() OR (revoked = TRUE AND created_at < NOW() - INTERVAL '24 hours')");
  await run("UPDATE active_sessions SET active = FALSE WHERE active = TRUE AND last_activity < NOW() - INTERVAL '24 hours'");

  // ✅ CORREÇÃO: Cleanup de audit_logs antigos (retenção 180 dias)
  await run("DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '180 days'");
  await run("DELETE FROM monitoring_logs WHERE recorded_at < NOW() - INTERVAL '30 days'");
  await run("DELETE FROM export_logs WHERE created_at < NOW() - INTERVAL '90 days'");

  app.listen(PORT, () => {
    console.log(`
 🚀 SGD Backend Server Running
 =============================
 Port: ${PORT}
 Environment: ${process.env.NODE_ENV || 'development'}
 API: http://localhost:${PORT}/api
 Health: http://localhost:${PORT}/api/health
 =============================
 `);
  });
}

if (process.env.NODE_ENV !== 'test') {
  start();
}

export default app;
