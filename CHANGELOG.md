# Changelog

All notable changes to the SGD Consultoria project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] — 2026-08-07

# Fase 3.1 — Administração dos Sistemas de Integração

Implementa a administração completa dos sistemas de integração governamentais
(Transferegov, SEI e CGLOG) no SGD, entregue em fases incrementais: A, B, C1, C2,
C3, C4 e C4.1. Referência técnica detalhada em [`docs/integracoes.md`](docs/integracoes.md).

### Fase A — Fundação: schema de saúde/histórico e permissões granulares

- **Migrações idempotentes** — `database.ts` (`initDatabase`) cria/altera as tabelas de integração sem quebrar reexecução.
- **Novas colunas em `integration_systems`**: `description`, `last_sync_at`, `last_error_at`, `last_error_message`, `last_http_status`, `last_response_ms`, `error_count_24h`, `consecutive_errors`.
- **Novas colunas em `integration_logs`**: `duration_ms`, `http_status`, `response_summary`, `triggered_by`, `error_message`.
- **Novos índices**: `idx_integration_systems_active`, `idx_integration_systems_last_sync`, `idx_integration_logs_status`, `idx_integration_logs_direction`.
- **`secretConfigured`** agora valida a existência da env var do secret (não apenas o campo configurado).
- **Permissões granulares** — `integrations.view` (leitura) e `integrations.manage` (escrita) substituem `requireRole('admin')` nas rotas de integração.
- **Correção do contador de integrações no monitoramento** (`entity_type IN ('integration','integration_system')`).
- **Testes** — gestor com `view` lista/detalha; usuário sem permissão recebe 403; `description` persistida; `secretConfigured` false sem env; cleanup de FK no `afterAll`.

### Fase B — Backend de Administração de Integrações

- **`lib/adapterRegistry.ts`** — registro central de adapters com `getAdapter` e `listAdapters`.
- **`lib/integrationAdmin.ts`** — lógica de dashboard, saúde, histórico, detalhes e sincronização manual (`runManualSync`).
- **`routes/integrationAdmin.ts`** — endpoints administrativos:
  - `GET /api/integrations/admin/dashboard` — KPIs consolidados (total/active/inactive, última sync, falhas 24h, status geral).
  - `GET /api/integrations/admin/health` — saúde individual por sistema (operational/attention/failure) com HTTP status, tempo e falhas consecutivas.
  - `GET /api/integrations/admin/logs` — histórico paginado e filtrado (sistema, status, direção, período, erros, busca).
  - `GET /api/integrations/admin/systems/:id` — detalhes com config redigida, health e eventos recentes.
  - `GET /api/integrations/admin/adapters` — lista de adapters registrados.
  - `POST /api/integrations/admin/systems/:id/sync` — sincronização manual com payload (motor real) ou health-check de endpoint.
- **Instrumentação do processamento** — `lib/integrationProcessor.ts` registra `duration_ms`, `triggered_by`, `error_message`, `http_status` em `integration_logs` e `audit_logs`.
- **Testes** — suíte `integrationAdmin.test.ts`.

### Fase C1 — Frontend: fundação da área administrativa

- **Rota e menu** — `App.tsx` e `Sidebar.tsx` (ícone Plug) com guarda `integrations.view`.
- **`IntegrationAdminView.tsx`** — página inicial placeholder ("Painel em desenvolvimento").
- **`services/api.ts`** — client `integrationAdminApi` (dashboard, health, logs, systems, sync, adapters).
- **`types.ts`** — tipos `Integration*` (System, Log, Health, Dashboard, SyncResult, etc.).

### Fase C2 — Dashboard administrativo

- **Estrutura de abas** Dashboard, Saúde dos Sistemas, Histórico de Integrações e Sistemas.
- **Dashboard** — KPIs (total/ativos/inativos, falhas 24h) e card de status geral (healthy/warning/critical) com última sync e último erro.
- **Filtros e indicadores** via componentes reutilizados (`PageHeader`, `Kpi`, `Card`, `Table`, `Skeleton`, `EmptyState`).

### Fase C3 — Saúde dos Sistemas e Histórico

- **`IntegrationHealthTable.tsx`** — tabela de saúde individual (status, última sincronização, HTTP, tempo de resposta, falhas).
- **`IntegrationLogsTable.tsx`** — histórico paginado/filtrado com busca, período, direção, status, apenas erros e exportação CSV/JSON via `ExportMenu`.
- **`IntegrationAdminView.tsx`** — integração das abas, estados de loading/erro/vazio e tratamento de permissões.

### Fase C4 — CRUD de Sistemas e Sincronização Manual

- **`IntegrationSystemsTable.tsx`** — tabela com busca, filtro `active`, paginação e ações por linha (ver/editar/ativar/desativar/sincronizar); botão "Novo Sistema".
- **`IntegrationSystemForm.tsx`** — modal criar/editar com validação (code regex, campos obrigatórios, `code`/`secret_env_key` imutáveis na edição) e máscara de config.
- **`IntegrationSystemDrawer.tsx`** — detalhes do sistema via `GET /admin/systems/:id` (geral, saúde, config redigida, 10 eventos recentes).
- **`SyncResultModal.tsx`** — modal de resultado da sincronização (`success`/`warning`/`error`, HTTP, duração, eventId, erro).
- **Backend CRUD** — `lib/integrationSystems.ts` + `routes/integrations.ts`: criar, atualizar, ativar e desativar com auditoria (`integration.system.created/updated/activated/deactivated`).
- **Controle por permissões** — `canManage`/`canSync` habilitam ações conforme `integrations.manage`/`integrations.sync`.

### Fase C4.1 — Hardening de Configurações Sensíveis

- **`lib/redact.ts`** — `sanitizeIntegrationConfig` (redige `api_key`/`password`/`token`/`secret`/`private_key`/`authorization`/`credential` para `[REDACTED]`, recursivo) e `mergeIntegrationConfig` (preserva valor existente em `[REDACTED]`/`********`; `null` remove a chave).
- **`canViewSensitiveConfig`** — apenas `integrations.manage` (ou role admin) vê valores reais de `config`; `integrations.view` recebe `[REDACTED]`.
- **GETs de sistemas** — `mapSystem` aplica sanitização conforme a permissão do usuário em `/systems` e `/systems/:id`.
- **Drawer administrativo** — `getSystemDetail` sempre redige via `sanitizeIntegrationConfig(config, false)`.
- **Frontend `lib/integrationConfig.ts`** — `maskConfigForDisplay` (exibe `********`) e `unmaskConfigForSubmit` (converte `********` → `[REDACTED]` no submit).
- **Merge seguro no PUT** — `update()` preserva o segredo quando o campo chega como sentinela; nunca persiste placeholders como segredo real.

### Segurança (transversal)

- **JWT** — autenticação frontend/admin (`authenticateToken`); `req.user.permissions` no payload.
- **Refresh Token** — `JWT_REFRESH_SECRET` (fallback derivado de `JWT_SECRET` em dev).
- **Cookies** — `csrf_token` (HttpOnly, SameSite=Lax) para proteção CSRF em escritas.
- **CSRF** — `csrfProtection` global em `server.ts` (exceto `/api/auth*` e `/password-reset/*`); aplicado em todas as escritas de integração.
- **RBAC** — `requirePermission` com bypass para `admin`/`administrador`; permissões `integrations.view/manage/sync`.
- **Segredos fora do banco** — `secret_env_key` referencia env var; o secret real nunca é persistido nem logado em claro.

### Testes

Backend
- 196 testes automatizados aprovados (18 arquivos) — `npx vitest run`; `tsc --noEmit` sem erros.
- Cobertura: `integrationSystems.test.ts`, `integrationAdmin.test.ts`, webhooks, processor, sync, adapters, status mapping.

Frontend
- TypeScript OK (`tsc --noEmit`).
- Build OK (`npm run build`) — apenas warnings pré-existentes de chunk size.
