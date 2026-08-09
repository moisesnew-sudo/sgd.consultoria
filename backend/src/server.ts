import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { logger } from './lib/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// ✅ CORREÇÃO: Validação rigorosa de secrets no startup
// ============================================================
function validateEnv() {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.JWT_SECRET) {
    errors.push('JWT_SECRET não definido');
  } else if (process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET deve ter pelo menos 32 caracteres');
  } else if (process.env.JWT_SECRET === 'undefined' || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'default') {
    errors.push('JWT_SECRET não pode ser um valor padrão/fraco');
  }

  if (!process.env.JWT_REFRESH_SECRET) {
    warnings.push('JWT_REFRESH_SECRET não definido — usando fallback derived de JWT_SECRET. Recomendado: chave exclusiva em produção.');
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

  if (warnings.length > 0) {
    warnings.forEach(w => logger.warn(`⚠️  ${w}`));
  }

  if (errors.length > 0) {
    logger.error('❌ ERROS DE CONFIGURAÇÃO CRÍTICOS:');
    errors.forEach(e => logger.error(`   - ${e}`));
    process.exit(1);
  }
}

validateEnv();

// Import routes
import authRoutes from './routes/auth.js';
import demandsRoutes from './routes/demands.js';
import municipalitiesRoutes from './routes/municipalities.js';
import standardizationRoutes from './routes/standardization.js';
import organsRoutes from './routes/organs.js';
import settingsRoutes from './routes/settings.js';
import commentsRoutes from './routes/comments.js';
import auditRoutes from './routes/audit.js';
import integrationsRoutes from './routes/integrations.js';
import integrationAdminRoutes from './routes/integrationAdmin.js';
import webhookRoutes from './routes/webhooks.js';
import permissionsRoutes from './routes/permissions.js';
import passwordResetRoutes from './routes/password-reset.js';
import sessionsRoutes from './routes/sessions.js';
import backupsRoutes from './routes/backups.js';
import monitoringRoutes from './routes/monitoring.js';
import lgpdRoutes from './routes/lgpd.js';
import uploadRoutes from './routes/upload.js';
import sseRoutes from './routes/sse.js';
import webhookAdminRoutes from './routes/webhookAdmin.js';
import { csrfProtection } from './middleware/csrf.js';
import { createInstitutionalRateLimit } from './middleware/rateLimit.js';
import { recordApiRequest } from './lib/healthStatus.js';
import { registerCacheInvalidation } from './lib/cache.js';
import { runSeed } from './seed.js';
import { initDatabase, run } from './database.js';
import { startAlertScheduler, stopAlertScheduler } from './lib/alertScheduler.js';
import { startIntegrationScheduler, stopIntegrationScheduler } from './lib/integrationScheduler.js';
import { startWebhookDispatcher, stopWebhookDispatcher } from './lib/webhookDispatcher.js';
import { startJobWorker, stopJobWorker } from './lib/jobQueue.js';
import { startPostgresListener, stopPostgresListener } from './lib/eventBusPostgres.js';
import { getHealthReport } from './lib/healthStatus.js';
import { pool } from './database.js';
import { closeAllSSEClients } from './routes/sse.js';

const app = express();
const PORT = process.env.PORT || 3001;

// F2.1 — Referência ao servidor HTTP para graceful shutdown.
let server: Server | null = null;
let shuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '15000', 10);

// Trust proxy — required for correct req.ip behind Render/load balancers.
// Prevents all requests from sharing the same rate limit bucket.
app.set('trust proxy', 1);

// Health check (liveness) — registered BEFORE all middleware.
// No auth, no CSRF, no rate limit. Always returns 200 if the process is alive.
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// Readiness check — checks database connectivity and component state.
// Returns 203 if ready, 503 if not. No auth required (used by orchestrators).
app.get('/api/health/ready', async (_req, res) => {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const dbMs = Date.now() - start;

    const report = getHealthReport();

    const ready = report.database.status !== 'down';
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      timestamp: report.timestamp,
      uptime: report.uptime,
      version: report.version,
      database: { ...report.database, responseTimeMs: dbMs },
      postgresListener: report.postgresListener,
      eventBus: report.eventBus,
      sse: report.sse,
      scheduler: report.scheduler,
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'database_unreachable',
    });
  }
});

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
  connectSrc: ["'self'"],
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

// Compression — skip for SSE endpoints (text/event-stream must not be buffered)
app.use(compression({
  filter: (req, res) => {
    if (req.path === '/events/integrations') return false;
    return compression.filter(req, res);
  },
}));

// ✅ CORREÇÃO: CORS com validação estrita de origens
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(s => s.trim())
  .filter(s => s.length > 0 && s !== '*');

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
    logger.error('❌ CORS_ORIGIN não configurado corretamente em produção');
  process.exit(1);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
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
  legacyHeaders: true,
  // Webhooks externos possuem limiter dedicado (máx. maior, para retries legítimos)
  skip: (req) => req.path.startsWith('/integrations/webhooks') || req.path.startsWith('/health')
});

// F2.2 — Limiter institucional por usuário autenticado (anônimo por IP,
// autenticado por usuário, admin com limite superior). Rodado após o
// cookieParser para poder ler o JWT; registra bloqueios no healthStatus.
const apiLimiterInstitutional = createInstitutionalRateLimit();

// Limiter dedicado para webhooks (sistemas externos podem retryar eventos)
const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX || '1000'),
  message: { error: 'Muitas requisições de webhook. Tente novamente mais tarde.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/auth/login', authLimiter);
app.use('/api/password-reset/request', express.json({ limit: '10mb' }));
app.use('/api/password-reset/request', passwordResetLimiter);
app.use('/api/', apiLimiter);

// Cookies
app.use(cookieParser());

// F2.2 — Limiter institucional (por usuário/IP/admin), após cookies.
app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/integrations/webhooks')) return next();
  return apiLimiterInstitutional(req, res, next);
});

// ✅ Webhooks externos: autenticados por HMAC (sem cookie/JWT), montados ANTES do CSRF.
// express.raw captura o body como Buffer — assinatura HMAC sobre bytes exatos.
// Precisa vir ANTES do express.json global para que o body chegue cru ao middleware.
app.use('/api/integrations/webhooks', webhookLimiter);
app.use('/api/integrations/webhooks', express.raw({ type: () => true, limit: '10mb' }));
app.use('/api/integrations/webhooks', webhookRoutes);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// F2.2 — Métricas de performance da API (requisições, 4xx/5xx, latência).
app.use('/api/', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    try {
      recordApiRequest(res.statusCode, Date.now() - start);
    } catch { /* métricas nunca derrubam o request */ }
  });
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/password-reset', passwordResetRoutes);

// ✅ CORREÇÃO: CSRF ativado nos endpoints de escrita (cliente envia X-CSRF-Token)
// /api/auth e /api/password-reset ficam fora da proteção: exigem fluxo sem cookie csrf preexistente
// csrfProtection já isenta métodos seguros (GET/HEAD/OPTIONS) internamente (ver middleware/csrf.js),
// e /api/health também é resolvida antes deste middleware por estar registrada no topo do arquivo.
app.use(csrfProtection);

app.use('/api/demands', demandsRoutes);
app.use('/api/demands', commentsRoutes);
app.use('/api/municipalities', municipalitiesRoutes);
app.use('/api/standardization', standardizationRoutes);
app.use('/api/organs', organsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/integrations', integrationAdminRoutes);
app.use('/api/admin/outbound-webhooks', webhookAdminRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/backups', backupsRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/lgpd', lgpdRoutes);
app.use('/api', uploadRoutes);
app.use('/api', sseRoutes);

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
  logger.error('Unhandled error', { error: err.message, stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor'
      : err.message
  });
});

// Política de retenção. Executada no boot; idempotente e não-crítica.
// A retenção de integration_alerts remove APENAS alertas 'resolved' com mais de 90 dias;
// alertas open/acknowledged nunca são apagados (política Fase D1.2).
export async function runCleanup(): Promise<void> {
  await run("DELETE FROM active_sessions WHERE active = FALSE AND last_activity < NOW() - INTERVAL '24 hours'");
  await run("DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '48 hours'");
  await run("DELETE FROM token_blacklist WHERE expires_at < NOW()");
  await run("DELETE FROM refresh_tokens WHERE expires_at < NOW() OR (revoked = TRUE AND created_at < NOW() - INTERVAL '24 hours')");
  await run("UPDATE active_sessions SET active = FALSE WHERE active = TRUE AND last_activity < NOW() - INTERVAL '24 hours'");
  await run("DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '180 days'");
  await run("DELETE FROM monitoring_logs WHERE recorded_at < NOW() - INTERVAL '30 days'");
  await run("DELETE FROM export_logs WHERE created_at < NOW() - INTERVAL '90 days'");
  await run("DELETE FROM integration_alerts WHERE status = 'resolved' AND updated_at < NOW() - INTERVAL '90 days'");
}

// Start server
async function start() {
  try {
    await initDatabase();
    await runSeed();
  } catch (err) {
    logger.error('Falha na inicialização do banco', { error: err instanceof Error ? err.message : err });
    process.exit(1);
  }

  try {
    await runCleanup();
  } catch (err) {
    logger.warn('Cleanup executado com erros (não crítico)', { error: err instanceof Error ? err.message : err });
  }

  // D1.4 — Agendar avaliação periódica de alertas (após init+cleanup, antes de listen).
  startAlertScheduler();

  // E1.2 — Agendar sincronização periódica de integrações governamentais.
  startIntegrationScheduler();

  // D1.7 — Iniciar listener PostgreSQL LISTEN/NOTIFY para SSE multi-instância.
  startPostgresListener().catch((err) => {
    logger.warn('Listener PostgreSQL falhou ao iniciar (não crítico)', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // D3.1 — Iniciar webhook dispatcher (entrega assíncrona de eventos para endpoints externos).
  startWebhookDispatcher();

  // F2.2 — Invalidação de cache por evento (demand:updated etc.).
  registerCacheInvalidation();

  // F2.2 — Worker da fila assíncrona (jobs com retry/backoff).
  startJobWorker();

  server = app.listen(PORT, () => {
    logger.info('SGD Backend Server Running', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });

  // F2.1 — Falha explícita de listen (porta em uso, permissão, etc.) não fica silenciosa.
  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error('Falha ao iniciar o servidor HTTP', { error: err.message, code: err.code });
    process.exit(1);
  });
}

// F2.1 — Graceful shutdown completo com timeout máximo e log por etapa.
// Fluxo: SIGTERM/SIGINT → parar novas requisições → encerrar SSE → parar
// schedulers → fechar listener PostgreSQL → fechar pool → finalizar processo.
async function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Recebido ${signal} — iniciando graceful shutdown`);

  const forceExitTimer = setTimeout(() => {
    logger.error(`Graceful shutdown excedeu o timeout de ${SHUTDOWN_TIMEOUT_MS}ms — forçando saída`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // 1. Parar de receber novas requisições.
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    logger.info('Shutdown: servidor HTTP parado (novas requisições rejeitadas)');

    // 2. Encerrar conexões SSE ativas (cliente é instruído a reconectar).
    closeAllSSEClients('server_shutdown');
    logger.info('Shutdown: conexões SSE encerradas');

    // 3. Parar schedulers e webhook dispatcher.
    stopAlertScheduler();
    stopIntegrationScheduler();
    stopWebhookDispatcher();
    stopJobWorker();
    logger.info('Shutdown: schedulers e webhook dispatcher parados');

    // 4. Fechar listener PostgreSQL LISTEN/NOTIFY.
    await stopPostgresListener();
    logger.info('Shutdown: listener PostgreSQL fechado');

    // 5. Fechar pool de banco de dados.
    try {
      await pool.end();
    } catch { /* pool já encerrado */ }
    logger.info('Shutdown: pool de banco de dados fechado');

    clearTimeout(forceExitTimer);
    logger.info('Graceful shutdown concluído');
    process.exit(0);
  } catch (err) {
    logger.error('Erro durante graceful shutdown', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

if (process.env.NODE_ENV !== 'test') {
  start();
}

export default app;
