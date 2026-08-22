# Deploy e Infraestrutura — SGD

Guia de implantação, infraestrutura e operações do Sistema de Gestão de Demandas.

---

## 1. Arquitetura de Deploy

```mermaid
graph LR
    A[Usuário] -->|HTTPS| B[Vercel<br/>Frontend React]
    A -->|HTTPS| C[Render.com<br/>Backend Express]
    C --> D[(PostgreSQL<br/>Render Managed)]
    B -->|API calls| C
    C -->|webhooks| E[Transferegov/SEI/CGLOG]
    E -->|POST /webhooks| C
```

---

## 2. Frontend (Vercel)

### Configuração

| Item | Valor |
|------|-------|
| Plataforma | Vercel |
| Framework | React (SPA) |
| Build | `tsc && vite build` |
| Output | `dist/` |
| SPA Rewrites | `/(.*) → /index.html` |

### Variáveis de Ambiente

| Variável | Descrição |
|----------|-----------|
| — | Nenhuma variável de ambiente pública necessária |

### Build

```bash
cd frontend
npm install
npm run build    # tsc + vite build
```

### Deploy

- Push na branch `main` → deploy automático
- Preview deploy em PRs
- Domínio: `gruposgd.com.br`

---

## 3. Backend (Render.com)

### Configuração (render.yaml)

| Item | Valor |
|------|-------|
| Serviço | `sgd-backend` |
| Runtime | Node.js |
| Plano | Free (starter para produção) |
| Root Dir | `backend` |
| Build | `npm install && npm run build` |
| Start | `npm start` (`tsx src/server.ts`) |
| Health Check | `/api/health` |

### Variáveis de Ambiente

#### Obrigatórias

| Variável | Descrição |
|----------|-----------|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | URL de conexão PostgreSQL |
| `JWT_SECRET` | ≥32 caracteres aleatórios |
| `JWT_REFRESH_SECRET` | Diferente do JWT_SECRET; definir diretamente no Render Dashboard (`sync: false`, não versionado) |
| `CORS_ORIGIN` | `https://gruposgd.com.br,https://www.gruposgd.com.br` |
| `COOKIE_DOMAIN` | `gruposgd.com.br` |
| `PUBLIC_API_URL` | `https://api.gruposgd.com.br/api` |
| `FRONTEND_URL` | `https://gruposgd.com.br` — obrigatória em produção; usada nos links de recuperação de senha |
| `EMAIL_ENABLED` | `false` no Release Candidate — ver seção **E-mail** abaixo |

#### Integrações

| Variável | Descrição |
|----------|-----------|
| `TRANSFEREGOV_BASE_URL` | URL da API Transferegov |
| `TRANSFEREGOV_API_KEY` | Chave de API |
| `TRANSFEREGOV_WEBHOOK_SECRET` | Secret HMAC (≥16 chars) |
| `SEI_BASE_URL` | URL da API SEI |
| `SEI_API_TOKEN` | Token de integração |
| `SEI_WEBHOOK_SECRET` | Secret HMAC |
| `CGLOG_BASE_URL` | URL da API CGLOG |
| `CGLOG_API_TOKEN` | Token de integração |
| `CGLOG_WEBHOOK_SECRET` | Secret HMAC |

#### Opcionais

| Variável | Descrição |
|----------|-----------|
| `DB_CA_CERT` | Certificado CA para SSL |
| `INTEGRATION_SYNC_INTERVAL_MS` | Intervalo do scheduler (default: 60000) |
| `LOG_LEVEL` | Nível de log (debug/info/warn/error) |
| `SEED_DEFAULT_PASSWORD` | Senha padrão dos usuários seed |
| `SEED_ADMIN_PASSWORD` | Senha do admin |

#### E-mail (EMAIL_ENABLED)

O envio de e-mail é controlado pela variável `EMAIL_ENABLED`. No **Release
Candidate o e-mail está deliberadamente desabilitado**: a configuração
SMTP/OAuth2 é uma etapa **pós-release**.

Com `EMAIL_ENABLED=false`:

- O backend **sobe normalmente em produção** — a validação SMTP do startup é ignorada;
- O fluxo de **recuperação de senha continua funcional**: o token de reset é gerado,
  persistido (30 min, uso único) e pode ser processado normalmente;
- O **envio efetivo do e-mail fica desabilitado** — a solicitação responde com sucesso
  e registra em log que o e-mail não foi enviado;
- Nenhuma credencial SMTP precisa existir no ambiente.

### SMTP (pós-release)

Para habilitar o envio de e-mails após o release, definir no Render Dashboard:

| Variável | Descrição |
|----------|-----------|
| `EMAIL_ENABLED` | `true` |
| `SMTP_HOST` | Host do servidor SMTP institucional |
| `SMTP_PORT` | `587` (STARTTLS) ou `465` (SSL) |
| `SMTP_USER` | Usuário da conta de envio |
| `SMTP_PASS` | Senha ou senha de app da conta de envio |
| `SMTP_FROM` | Remetente exibido, ex.: `SGD <noreply@dominio.gov.br>` |

> Suporte a OAuth2 para SMTP (`SMTP_AUTH_TYPE=oauth2` e variáveis associadas) está
> planejado como etapa pós-release e **não** faz parte da configuração atual.

Atenção: com `EMAIL_ENABLED=true` em produção, `validateEnv()` exige `SMTP_HOST`,
`SMTP_USER` e `SMTP_PASS` preenchidos e **encerra o processo (exit 1)** se estiverem
ausentes — ver Troubleshooting.

---

## 4. PostgreSQL

### Render Managed Database

| Item | Valor |
|------|-------|
| Plano | Free / Starter |
| Versão | PostgreSQL 16 |
| Conexão | Via `DATABASE_URL` |
| SSL | Habilitado em produção |

### Migrações

O banco é **idempotente** — `initDatabase()` cria todas as tabelas com
`CREATE TABLE IF NOT EXISTS`. Não há migration files separados.

```bash
# Inicializar banco (cria tabelas + seed)
cd backend
npx tsx src/database.ts
# ou
npm run db:seed
```

### Conexão

```
DATABASE_URL=postgresql://user:password@host:5432/sgd
```

Pool: pg defaults (max 10 conexões)

---

## 5. Processo de Deploy

### Backend

1. Push na branch `main`
2. Render detecta mudança e inicia build
3. `npm install && npm run build` (compila TypeScript)
4. `npm start` (inicia `tsx src/server.ts`)
5. Startup sequence:
   - `validateEnv()` → valida variáveis
   - `initDatabase()` → cria/migra tabelas
   - `runSeed()` → dados iniciais (idempotente)
   - `runCleanup()` → limpeza de dados antigos
   - `startAlertScheduler()` → alertas periódicos
   - `startIntegrationScheduler()` → sync de integrações
   - `startPostgresListener()` → LISTEN/NOTIFY
   - `startWebhookDispatcher()` → webhooks outbound
   - `app.listen(3001)`

### Frontend

1. Push na branch `main`
2. Vercel detecta mudança e inicia build
3. `tsc && vite build` → gera `dist/`
4. Deploy automático no domínio

---

## 6. Rollback

### Backend

1. No Render Dashboard → History → selecione deploy anterior
2. Clique "Rollback to this deploy"
3. Verificar logs: `GET /api/health` deve retornar 200

### Frontend

1. No Vercel Dashboard → Deployments
2. Clique "..." no deploy anterior → "Promote to Production"

### Banco de Dados

- Backups automáticos (Render Managed)
- Restore via `POST /api/backups/:id/restore` (se backup disponível)
- Ou restore via Render Dashboard → Database → Backups

---

## 7. Health Checks

| Endpoint | Propósito | Auth |
|----------|-----------|------|
| `GET /api/health` | Liveness (está vivo?) | Não |
| `GET /api/health/ready` | Readiness (pronto para tráfego?) | Não |
| `GET /api/monitoring/health` | Health completo (server+DB+app) | Não |

### Configuração Render

- Health Check Path: `/api/health`
- Health Check Interval: 30s
- Failure Threshold: 3

---

## 8. Troubleshooting

### Servidor não inicia

`validateEnv()` executa antes de qualquer rota e encerra o processo (`exit 1`)
listando os erros críticos nos logs do Render.

1. Verificar `DATABASE_URL` — `psql $DATABASE_URL -c "SELECT 1"`
2. Verificar `JWT_SECRET` — ≥32 caracteres
3. Verificar `CORS_ORIGIN` — não pode ser `*` em produção
4. Verificar `FRONTEND_URL` — obrigatória em produção (usada nos links de recuperação de senha); vazia causa exit 1
5. Verificar e-mail — em produção, com `EMAIL_ENABLED` diferente de `false`, `SMTP_HOST`, `SMTP_USER` e `SMTP_PASS` são obrigatórios; ausentes causam exit 1. No RC manter `EMAIL_ENABLED=false` até a configuração SMTP pós-release
6. Verificar logs do Render (a mensagem `❌ ERROS DE CONFIGURAÇÃO CRÍTICOS` lista exatamente quais variáveis faltam)

### Erro 502 Bad Gateway

1. Verificar se o build passou: `npm run build`
2. Verificar se `tsx` está instalado
3. Verificar memória (Render free tier: 512MB)
4. Verificar se o banco está acessível

### Webhooks não checam

1. Verificar `TRANSFEREGOV_WEBHOOK_SECRET` / `SEI_WEBHOOK_SECRET` / `CGLOG_WEBHOOK_SECRET`
2. Verificar se o sistema externo aponta para `https://api.gruposgd.com.br/api/integrations/webhooks/:system`
3. Verificar HMAC: `X-Signature`, `X-Timestamp`, `X-Idempotency-Key`

### Integrações falham (R9/R10)

1. **R9 (auth_failure):** Verificar API key/token no Render Dashboard
2. **R10 (api_unavailable):** Verificar `baseUrl` no config do sistema
3. Consultar `docs/homologacao.md` para guia completo

### Frontend não conecta ao backend

1. Verificar `CORS_ORIGIN` inclui o domínio do frontend
2. Verificar HTTPS (cookies não funcionam sem HTTPS)
3. Verificar `COOKIE_DOMAIN` = `gruposgd.com.br`

---

## 9. Variáveis de Ambiente — Referência Rápida

```bash
# === Banco ===
DATABASE_URL=postgresql://...
DB_CA_CERT=            # opcional, SSL

# === Auth ===
JWT_SECRET=            # ≥32 chars
JWT_REFRESH_SECRET=    # diferente do JWT_SECRET

# === Frontend ===
CORS_ORIGIN=https://gruposgd.com.br,https://www.gruposgd.com.br
COOKIE_DOMAIN=gruposgd.com.br
WEBAPP_URL=https://gruposgd.com.br
FRONTEND_URL=https://gruposgd.com.br    # obrigatória em produção (links de reset de senha)
PUBLIC_API_URL=https://api.gruposgd.com.br/api

# === Email ===
# RC: e-mail desabilitado — SMTP é pós-release
EMAIL_ENABLED=false
# Para ativar após o release:
# EMAIL_ENABLED=true
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASS=
# SMTP_FROM="SGD <noreply@...>"

# === Servidor ===
NODE_ENV=production
PORT=3001

# === Integrações ===
TRANSFEREGOV_BASE_URL=...
TRANSFEREGOV_API_KEY=...
TRANSFEREGOV_WEBHOOK_SECRET=...
SEI_BASE_URL=...
SEI_API_TOKEN=...
SEI_WEBHOOK_SECRET=...
CGLOG_BASE_URL=...
CGLOG_API_TOKEN=...
CGLOG_WEBHOOK_SECRET=...

# === Opcionais ===
INTEGRATION_SYNC_INTERVAL_MS=60000
LOG_LEVEL=info
```
