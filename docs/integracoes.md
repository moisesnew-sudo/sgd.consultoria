# Documentação Técnica — Módulo de Integrações Governamentais

Módulo responsável por receber, autententar, normalizar, sincronizar e administrar
eventos provenientes de sistemas governamentais externos (Transferegov, SEI e CGLOG),
mantendo as demandas do SGD sincronizadas com o status externo de forma
automática, segura e auditável.

---

# 1. Visão Geral

## Objetivo
Fornecer um canal de integração **servidor-a-servidor** entre o SGD e os sistemas
externos do Governo Federal (Transferegov, SEI e CGLOG), mantendo as demandas do SGD
sincronizadas com o status externo de forma automática, segura e auditável, e
oferecendo uma área administrativa para monitoramento e gerenciamento.

## Responsabilidades
- Receber eventos assíncronos (webhooks) de sistemas externos com autenticação HMAC.
- Normalizar *payloads* heterogêneos em um formato canônico via **adapters**.
- Mapear status externos para o status interno do SGD.
- Aplicar alterações de status e/ou prazo nas demandas SGD de forma **atômica**.
- Expor dashboard, saúde, histórico, administração de sistemas e sincronização manual.
- Proteger segredos e controlar acesso por permissões granulares.

## Benefícios
- Redução de trabalho manual na atualização de demandas.
- Visibilidade em tempo real da saúde das integrações.
- Auditoria completa de todas as operações.
- Administração centralizada (CRUD de sistemas, sync manual, alertas via health).

## Fluxo geral
```
                 ┌────────────────────────┐
                 │  Sistema externo        │
                 │  (Transferegov/SEI/CGLOG)│
                 └───────────┬────────────┘
                             │ POST /api/integrations/webhooks/:system (HMAC)
                             ▼
                 ┌────────────────────────┐
                 │  middleware/          │
                 │  webhookAuth.ts       │  ← HMAC-SHA256 + timestamp + anti-replay
                 └───────────┬────────────┘
                             │
                             ▼
                 ┌────────────────────────┐
                 │  routes/webhooks.ts     │
                 └───────────┬────────────┘
                             │ webhook_events (raw/idempotente)
                             │ integration_logs (inbound)
                             ▼
                 ┌────────────────────────┐
                 │  lib/                   │
                 │  integrationProcessor   │  ← transação atômica
                 └───────────┬────────────┘
                             │ adapter.normalize() → syncIntegrationEvent()
                             ▼
                 ┌────────────────────────┐
                 │  Banco: demands,       │
                 │  demand_integrations   │
                 └───────────┬────────────┘
                             │
                  ┌──────────┴──────────┐
                  ▼                      ▼
     timeline_events /    audit_logs
     integration_logs
```

---

# 2. Arquitetura

## Camadas
```
Frontend
    ↓  (HTTPS + JWT + CSRF)
API (Express)
    ↓  Middlewares
        - authenticateToken (JWT)
        - requirePermission (RBAC)
        - csrfProtection (exceto webhooks/auth)
        - authenticateWebhook (HMAC, apenas para /webhooks)
    ↓  Integrações
        - routes/integrations.ts      (CRUD de sistemas)
        - routes/integrationAdmin.ts  (dashboard/saúde/logs/sync)
        - routes/webhooks.ts          (entrada de eventos)
    ↓  Processamento
        - integrationProcessor.ts     (persistência atômica)
        - integrationSync.ts          (motor puro de normalização)
        - adapterRegistry.ts          (resolução de adapters)
        - statusMapping.ts            (lookup de status)
    ↓  Banco (PostgreSQL via pg Pool)
    ↓  Auditoria
        - audit_logs, integration_logs, timeline_events
```

## Etapas do fluxo de sincronização (webhook)
1. **Entrada** — Sistema externo envia `POST /webhooks/:system` com `X-Signature`,
   `X-Timestamp`, `X-Idempotency-Key`.
2. **Autenticação** — `webhookAuth.ts` valida HMAC-SHA256 contra `process.env[secret_env_key]`.
3. **Persistência bruta** — `webhooks.ts` grava `webhook_events` (idempotente) e log
   `webhook.received` (direction `in`).
4. **Processamento** — `integrationProcessor.processWebhookEvent(eventId)`:
5. **Normalização** — `getAdapter(code)` → `adapter.normalize(payload)`.
6. **Busca demanda** — `findDemandByProposalNumber` (comparação case-insensitive).
7. **Mapeamento de status** — `getMappedStatus` → status interno SGD.
8. **Atualização demanda** — `UPDATE demands` (apenas `status`/`deadline`).
9. **Timeline** — `addTimelineEvent('Integração Sincronizada')`.
10. **Auditoria** — `logAudit('integration_sync')` → `audit_logs`.
11. **Vínculo** — UPSERT `demand_integrations` (ON CONFLICT demanda×sistema).
12. **Log de execução** — `integration_logs` (success + `duration_ms` + `triggered_by`).
13. **Encerramento** — `UPDATE webhook_events SET status='processed'`.

> Falhas → `persistUnmatched` (warning) / `persistFailure` (error), tudo dentro da mesma
> transação com rollback automático.

---

# 3. Banco de Dados

> Criação/migração em `backend/src/database.ts` → `initDatabase()` (idempotente).

## integration_systems
Cadastro dos sistemas externos integrados.

| Coluna                  | Tipo        | Observação |
|-------------------------|-------------|------------|
| `id`                    | SERIAL PK   | |
| `code`                  | TEXT UNIQUE | canônico (`transferegov`, `sei`, `cglog`); lowercase |
| `name`                  | TEXT        | nome amigável |
| `secret_env_key`        | TEXT        | env var do secret (não o secret em si) |
| `active`                | BOOLEAN     | default TRUE |
| `config`                | JSONB       | dados sensíveis (api_key, password…) |
| `description`           | TEXT        | (Fase A) |
| `last_sync_at`          | TIMESTAMPTZ | (Fase A) |
| `last_error_at`         | TIMESTAMPTZ | (Fase A) |
| `last_error_message`    | TEXT        | (Fase A) |
| `last_http_status`      | INTEGER     | (Fase A) |
| `last_response_ms`      | INTEGER     | (Fase A) |
| `error_count_24h`       | INTEGER     | default 0 (Fase A) |
| `consecutive_errors`    | INTEGER     | default 0 (Fase A) |
| `created_at/updated_at` | TIMESTAMPTZ | |
| `tenant_id`             | INTEGER     | default 1 |

Índices: `idx_integration_systems_active`, `idx_integration_systems_last_sync`.
Relacionamentos: 1→N `webhook_events`, `integration_logs`, `demand_integrations`,
`integration_status_mapping`.

## webhook_events
Eventos brutos recebidos (fonte de verdade da idempotência).

| Coluna            | Tipo           | Observação |
|-------------------|----------------|------------|
| `id`              | SERIAL PK      | |
| `system_id`       | INTEGER FK → integration_systems(id) | |
| `system_code`     | TEXT           | cópia desnormalizada |
| `event_type`      | TEXT           | default 'unknown' |
| `idempotency_key` | TEXT UNIQUE    | deduplicação |
| `payload`         | JSONB          | body parseado |
| `headers`         | JSONB          | X-Signature/X-Timestamp/X-Idempotency-Key/content-type |
| `signature`       | TEXT           | X-Signature |
| `received_ip`     | TEXT           | |
| `status`          | TEXT CHECK     | pending/processed/failed/unmatched/duplicate |
| `error`           | TEXT           | mensagem de erro |
| `received_at`     | TIMESTAMPTZ    | |
| `processed_at`    | TIMESTAMPTZ    | |
| `tenant_id`       | INTEGER        | default 1 |

Índices: `idx_webhook_events_system/status/received`.

## integration_logs
Histórico de execuções (entrada e saída). Tabela de auditoria operacional.

| Coluna              | Tipo           | Observação |
|---------------------|----------------|------------|
| `id`                | SERIAL PK      | |
| `system_id`         | INTEGER FK     | nullable |
| `system_code`       | TEXT           | |
| `direction`         | TEXT CHECK     | in/out |
| `action`            | TEXT           | webhook.received/integration.sync/integration.system.created… |
| `demand_id`         | TEXT           | |
| `webhook_event_id`  | INTEGER FK → webhook_events(id) | |
| `status`            | TEXT CHECK     | success/warning/error |
| `message`           | TEXT           | |
| `duration_ms`       | INTEGER        | (Fase A) |
| `http_status`       | INTEGER        | (Fase A) |
| `response_summary`  | TEXT           | (Fase A) |
| `triggered_by`      | TEXT           | webhook/manual (Fase A) |
| `error_message`     | TEXT           | (Fase A) |
| `created_at`        | TIMESTAMPTZ    | |
| `tenant_id`         | INTEGER        | default 1 |

Índices: `idx_integration_logs_system/created/demand/status/direction`.

## demand_integrations
Vínculo entre demandas SGD e sistemas externos (histórico por par demanda×sistema).

| Coluna            | Tipo        | Observação |
|-------------------|-------------|------------|
| `id`              | SERIAL PK   | |
| `demand_id`       | TEXT FK → demands(id) ON DELETE CASCADE | |
| `system_id`       | INTEGER FK → integration_systems(id) | |
| `external_id`     | TEXT        | id externo (convênio/processo/protocolo) |
| `proposal_number` | TEXT        | número da proposta |
| `last_sync_at`    | TIMESTAMPTZ | |
| `sync_status`     | TEXT CHECK  | none/pending/synced/error |
| `data`            | JSONB       | { changes, event_type } |
| `created_at/updated_at` | TIMESTAMPTZ | |
| `tenant_id`       | INTEGER    | default 1 |

Restrição: `UNIQUE(demand_id, system_id)` → UPSERT. Índices: `proposal_number`,
`external_id`, `system_id`.

## integration_status_mapping
Mapeamento configurável de status externo → status interno do SGD.

| Coluna          | Tipo        | Observação |
|-----------------|-------------|------------|
| `id`            | SERIAL PK   | |
| `tenant_id`     | INTEGER     | default 1 |
| `system_id`     | INTEGER FK → integration_systems(id) | |
| `external_status` | TEXT      | CAIXA ALTA, sem acentos |
| `internal_status` | TEXT CHECK | analise/pendente/concluido/rejeitado |
| `description`   | TEXT        | |
| `active`        | BOOLEAN     | default TRUE |
| `created_at/updated_at` | TIMESTAMPTZ | |

Restrição: `UNIQUE(system_id, external_status)`. Índices: `system_id`, `external_status`, `active`.

## monitoring_logs
Snapshot periódico de saúde do servidor (`/api/monitoring/snapshot`, admin).

| Coluna              | Tipo  | Observação |
|---------------------|-------|------------|
| `server_cpu`        | REAL  | % |
| `server_memory`     | REAL  | % |
| `api_response_time` | INTEGER | ms |
| `db_connection_count` | INTEGER | |
| `active_users`      | INTEGER | |
| `total_demands`     | INTEGER | |
| `last_backup_at`    | TIMESTAMPTZ | |
| `recorded_at`       | TIMESTAMPTZ | default NOW() |

## audit_logs
Trilha de auditoria geral.

| Coluna      | Tipo       | Observação |
|-------------|------------|------------|
| `id`        | SERIAL PK  | |
| `entity_type` | TEXT    | demand / integration_system |
| `entity_id` | TEXT       | id da entidade |
| `action`    | TEXT       | integration_sync / integration.system.created… |
| `user_id`   | INTEGER FK → users(id) | |
| `user_name` | TEXT       | |
| `details`   | JSONB      | (+ `_ip`, `_os`, `_browser` adicionados por `logAudit`) |
| `created_at` | TIMESTAMPTZ | |

Índices: `idx_audit_entity`, `idx_audit_created`.

---

# 4. Segurança

## Autenticação (admin/frontend)
- **JWT** — `authenticateToken` valida o Bearer token; `req.user = { id, name, role, permissions[] }`.
- **Refresh Token** — `JWT_REFRESH_SECRET` (fallback derivado de `JWT_SECRET` em dev).
- **Cookies** — `csrf_token` (HttpOnly, SameSite=Lax) protege operações de escrita.

## CSRF
- `csrfProtection` global em `server.ts` (exceto `/api/auth/*` e `/password-reset/*`).
- Aplica-se a todo POST/PUT/PATCH de integração (GET é isento).
- Header `x-csrf-token` comparado com cookie `csrf_token`.

## Controle de permissões (RBAC)
- `requirePermission(key)` — concede bypass automático ao role `admin`/`administrador`.
- Usuário sem a permissão recebe 403.

## Webhook (entrada — sistemas externos)
- **HMAC-SHA256** — `X-Signature` sobre `timestamp\n[idempotency-key]\nbody`, secret
  lido de `process.env[secret_env_key]` (nunca persistido no DB).
- **Timestamp** — `X-Timestamp`, janela anti-replay de 5 minutos.
- **Idempotência** — `X-Idempotency-Key` (ou `sha256(body)`); `ON CONFLICT DO NOTHING`.
- Segredo requer comprimento mínimo de 16.

## Proteção de segredos
- **Sanitização** — `sanitizeIntegrationConfig(config, canViewSecrets)` redige chaves
  sensíveis (`api_key`, `password`, `token`, `secret`, `client_secret`,
  `private_key`, `authorization`, `credential`) para `[REDACTED]`.
- **Visibilidade por permissão** — apenas `integrations.manage` (ou admin) vê valores
  reais de `config`. `integrations.view` recebe `[REDACTED]` (recursive).
- **Merge seguro** — `mergeIntegrationConfig(existing, submitted)` preserva o valor
  existente quando o campo vem como `[REDACTED]` ou `********`; `null` remove a chave.
- **Nunca persistir placeholders** — o backend rejeita/não grava `[REDACTED]` ou
  `********` como segredo real; o frontend converte `********` → `[REDACTED]`
  (sentinela "manter") antes do submit.

---

# 5. Backend — Rotas

Base: `/api/integrations`

## Sistemas (`backend/src/routes/integrations.ts` + `lib/integrationSystems.ts`)

| Método | Rota                          | Permissão          | Finalidade |
|--------|-------------------------------|--------------------|------------|
| GET    | `/integrations`               | `integrations.view` | Info da API |
| GET    | `/integrations/systems`       | `integrations.view` | Listar (paginação, search, active) |
| GET    | `/integrations/systems/:id`   | `integrations.view` | Detalhar system |
| POST   | `/integrations/systems`       | `integrations.manage` + CSRF | Criar |
| PUT    | `/integrations/systems/:id`   | `integrations.manage` + CSRF | Atualizar (name/description/config; code e secret_env_key imutáveis) |
| PATCH  | `/integrations/systems/:id/activate`   | `integrations.manage` + CSRF | Ativar |
| PATCH  | `/integrations/systems/:id/deactivate` | `integrations.manage` + CSRF | Desativar |

## Administração (`backend/src/routes/integrationAdmin.ts` + `lib/integrationAdmin.ts`)

| Método | Rota                                | Permissão           | Finalidade |
|--------|-------------------------------------|---------------------|------------|
| GET    | `/integrations/admin/dashboard`     | `integrations.view` | KPIs consolidados (total/active/inactive, lastSync, failures24h, status) |
| GET    | `/integrations/admin/health`        | `integrations.view` | Saúde individual por sistema |
| GET    | `/integrations/admin/logs`          | `integrations.view` | Histórico paginado/filtrado |
| GET    | `/integrations/admin/systems/:id`   | `integrations.view` | Detalhes (config redigida, health, recentLogs) |
| GET    | `/integrations/admin/adapters`      | `integrations.view` | Lista de adapters |
| POST   | `/integrations/admin/systems/:id/sync` | `integrations.sync` + CSRF | Sincronização manual |

## Webhooks (`backend/src/routes/webhooks.ts`)
| Método | Rota                              | Auth      | Finalidade |
|--------|-----------------------------------|-----------|------------|
| POST   | `/integrations/webhooks/:system`  | HMAC-SHA256 | Recebimento de eventos (idempotente) |

---

# 6. Frontend

Página: **Integrações** (`activeTab === 'integration-admin'`) — visível com
`integrations.view` (menu lateral em `Sidebar.tsx`, ícone `Plug`).

## Abas (`IntegrationAdminView.tsx` → `TABS`)
| Aba                    | Ícone      | Componente              | Permissão |
|------------------------|------------|-------------------------|-----------|
| Dashboard              | `Activity` | KPIs + status geral     | `integrations.view` |
| Saúde dos Sistemas     | `Database` | `IntegrationHealthTable`| `integrations.view` |
| Histórico de Integrações | `List`   | `IntegrationLogsTable`  | `integrations.view` |
| Sistemas               | `Cog`      | `IntegrationSystemsTable` | `integrations.view` (+ `manage`/`sync` nas ações) |

## Componentes

### Dashboard (`IntegrationAdminView.tsx`)
KPIs: Total de Sistemas, Sistemas Ativos/Inativos, Falhas últimas 24h. Card de
"Status Geral" com indicador healthy/warning/critical, última sync e último erro.

### Saúde (`IntegrationHealthTable.tsx`)
Tabela: Nome, Status (operational/attention/failure), Última sincronização,
HTTP Status, Tempo resposta, Falhas.

### Histórico (`IntegrationLogsTable.tsx`)
Tabela paginada com filtros (sistema, status, direção, período, apenas erros, busca)
e exportação CSV/JSON via `ExportMenu`. Colunas: Sistema, Ação, Direção, Status,
Duração, HTTP, Data, Origem.

### Sistemas (`IntegrationSystemsTable.tsx`)
Tabela com busca, filtro `active` e paginação. Ações por linha: Ver (drawer),
Editar (form), Ativar/Desativar (botão Power), Sincronizar. Botão "Novo Sistema".

### Drawer de detalhes (`IntegrationSystemDrawer.tsx`)
Carrega `GET /admin/systems/:id`. Exibe: informações gerais, saúde do sistema
(status, última sync, último erro, HTTP, latência, falhas 24h/consecutivas),
config (redigida com `maskConfigForDisplay`), e 10 eventos recentes.

### Formulário (`IntegrationSystemForm.tsx`)
Modal para criar/editar. Campos: code (imutável em edição), name, description,
`secret_env_key` (nunca preenchido na edição), config (JSON, com máscara `********`
e hint "Deixe ******** para manter"), active. Validação Zod-style via regex.
No submit, `unmaskConfigForSubmit` converte `********` → `[REDACTED]`.

### Sincronização (`SyncResultModal.tsx`)
Modal pós-sync: status (success/warning/error), mensagem, HTTP status, duração,
eventId, detalhes do erro.

### Componentes reutilizados (`frontend/src/components/ui/`)
- `PageHeader` — cabeçalho com título/subtitle/ícone/ações.
- `Card` — painel com title/subtitle/icon.
- `Kpi` — indicador numérico com ícone.
- `Table` / `TableHead / TableBody / TableEmpty / Th / Tr / Td / Pagination`.
- `Drawer` — painel lateral deslizante.
- `Modal` — janela modal.
- `Skeleton` — placeholder de carregamento.
- `Alert` — notificação (success/warning/danger).
- `EmptyState` — estado vazio ilustrado.
- `ExportMenu` — menu de exportação (default export).
- `FiltersDrawer` — drawer de filtros.
- `Button`, `Input`, `Textarea`, `Select` (`Fields.tsx`).

---

# 7. Fluxo da Sincronização

```
Usuário                     Backend / Banco
   │                              │
   ├─► Botão "Sincronizar"        │
   │                              │
   │  POST /admin/systems/:id/sync
   │──────────────────────────────►│
   │                              │ runManualSync()
   │                              │  ├─ payload → cria webhook_events
   │                              │  └─ sem payload → GET config.endpoint
   │                              │  processWebhookEvent() / health-check
   │                              │  UPDATE integration_systems (health)
   │                              │  INSERT integration_logs
   │                              │  INSERT audit_logs
   │                              │
   │   Resposta (ManualSyncResult) │
   ◄──────────────────────────────│
   │                              │
   └─► SyncResultModal            ◄── Integration Processor / Logs / Demand / Timeline / Audit
```

## Responsabilidade por etapa
| Etapa                | Responsável | Função |
|----------------------|-------------|--------|
| Botão Sincronizar    | Frontend (`IntegrationSystemsTable` → `IntegrationAdminView`) | dispara `syncSystem` |
| API                  | `routes/integrationAdmin.ts` → `integrationAdmin.ts:runManualSync` | orquestra com/ou sem payload |
| Adapter              | `adapterRegistry.getAdapter` + `<code>.adapter.ts` | normaliza payload |
| Processor            | `integrationProcessor.processWebhookEvent` | persiste atomicamente |
| Logs                 | `integration_logs` + `audit_logs` | histórico e auditoria |
| Demand               | `demands` | atualização de status/padrazo |
| Timeline             | `timeline_events` (`addTimelineEvent`) | evento humano legível |
| Audit                | `audit_logs` (`logAudit`) | rastreamento de ação |

---

# 8. Permissões

| Permissão          | Categoria    | Permite |
|--------------------|--------------|--------|
| `integrations.view` | Integrações | Ver dashboard, saúde, logs, sistemas, detalhes, adapters; página de Integrações no menu |
| `integrations.manage` | Integrações | Criar/editar/ativar/desativar sistemas; ver valores reais de config |
| `integrations.sync` | Integrações | Executar sincronização manual (+ CSRF) |

> `admin` / `administrador` fazem **bypass** de `requirePermission` (leem/escrevem tudo).

---

# 9. Hardening implementado

## Funções (`lib/redact.ts` + `lib/integrationSystems.ts`)
- **`sanitizeIntegrationConfig(config, canViewSecrets)`** — recursivamente redige
  chaves sensíveis para `[REDACTED]` quando `canViewSecrets === false`.
- **`mergeIntegrationConfig(existing, submitted)`** — preserva o valor existente
  quando o campo vem como `[REDACTED]`/`********`; `null` remove a chave.
- **`canViewSensitiveConfig(user)`** — `true` apenas para `integrations.manage`
  ou role `admin`.

## Sentinels
- `[REDACTED]` — placeholder usado pelo backend para segredos ocultos.
- `********` — representação no frontend (exibida no formulário/drawer).

## Mecanismo
1. **Configuração mascarada** — em GET `/systems` e `/systems/:id`, `mapSystem`
   chama `sanitizeIntegrationConfig(row.config, canViewSensitiveConfig(req.user))`.
   Usuário com `view` → `[REDACTED]`; `manage` → valores reais.
2. **Configuração real** — apenas `integrations.manage` (ou admin) recebe valores reais.
3. **Proteção contra overwrite** — no PUT, `update()` chama `mergeIntegrationConfig`.
   Sentinela preserva o segredo; não há como sobrescrever com o placeholder.
4. **`getSystemDetail`** (drawer) sempre redige via `redactConfig` (`sanitizeIntegrationConfig(config, false)`).

## Por que essa abordagem
- **Segredo fora do BD** — `secret_env_key` referencia uma env var; o secret real
  nunca é persistido nem logado em claro.
- **Princípio do menor privilégio** — apenas quem administra vê segredos.
- **Experiência amigável** — o frontend mostra `********` para manter o segredo,
  evitando que o usuário precise reenviá-lo em cada edição.
- **Integridade** — merge evita perda acidental de segredo em atualizações parciais.

---

# 10. Componentes reutilizados

Utilitários compartilhados usados pela Administração de Integrações
(`frontend/src/components/ui/` + helpers):

| Componente  | Arquivo | Uso |
|-------------|---------|-----|
| `PageHeader` | `ui/PageHeader` | título/subtitle/ícone/ações |
| `Card`       | `ui/Card` | `Kpi` + painel |
| `Kpi`        | `ui/Card` | indicadores numéricos |
| `Table`, `Pagination` | `ui/Table` | tabelas paginadas |
| `Drawer`     | `ui/Drawer` | painel lateral (detalhes) |
| `Modal`      | `ui/Modal` | formulários e resultado |
| `Skeleton`   | `ui/Skeleton` | loading |
| `Alert`      | `ui/Alert` | erros/avisos |
| `EmptyState` | `ui/EmptyState` | estado vazio |
| `ExportMenu` | `ui/ExportMenu` | exportação (default export) |
| `FiltersDrawer` | `ui/FiltersDrawer` | filtros da tabela de logs |
| `Button`, `Input`, `Textarea`, `Select` | `ui/Fields` | formulários (Select sem prop `options`; usa `<option>`) |

Helpers frontend:
| Função | Arquivo | Uso |
|--------|---------|-----|
| `maskConfigForDisplay` | `lib/integrationConfig.ts` | `********` na exibição |
| `unmaskConfigForSubmit` | `lib/integrationConfig.ts` | converte `********` → `[REDACTED]` no submit |
| `formatDateShort`, `formatDate` | `services/api.ts` | formatação de datas |

---

# 11. Testes

## Backend
- **626 testes automatizados aprovados** (34 arquivos, `npx vitest run`).
- `npx tsc --noEmit`: sem erros.
- Cobertura relevante: `integrationSystems.test.ts`,
  `integrationAdmin.test.ts`, `integrations.test.ts` (webhooks),
  `integrationProcessor.test.ts`, `integrationSync.test.ts`,
  `integrationAdapters.test.ts`, `statusMapping.test.ts`,
  `transferegovHomologation.test.ts` (E2.2), `seiHomologation.test.ts` (E3.2)
  e `cglogHomologation.test.ts` (E3.3).

## Frontend
- `npx tsc --noEmit`: sem erros de tipo.
- `npm run build`: bundle gerado com sucesso (apenas *warnings* de chunk size > 500 kB, pré-existentes).

## Validações manuais realizadas
- **Permissões** — `view` lista/saúde/logs/detalhes; `manage` CRUD; `sync` sincronização; sem permissão → 403.
- **CSRF** — POST/PUT/PATCH sem header → 403; com header correto → 201/200.
- **Sincronização** — manual com payload (motor real) e sem payload (health-check de endpoint).
- **Hardening** — gestor vê `[REDACTED]`; admin vê real; PUT com `********` mantém segredo; PUT com novo valor atualiza.
- **Visualização** — drawer sempre redige config.
- **Administração** — ativar/desativar (botão Power), criar, editar, validações (code imutável, regex, required).

---

# 12. Próximas fases

## Fase D — Roadmap

> Alertas inteligentes R1–R10 (alertEngine) e observabilidade já implementados
> nas fases D1.3/E2.2 — veja `docs/homologacao.md` para o guia operacional.

### Dashboard executivo
- Visão agregada multitenant.
- Métricas de SLAs de sincronização (p95, p99).
- Gráficos de tendências históricas.

### Indicadores avançados
- Métricas de throughput (eventos/s, demandas sincronizadas).
- Detecção de drift entre sistema externo e SGD.
- Qualidade dos dados (campos incompletos no webhook).

### Novas integrações
- Suporte a novos sistemas (PNCP, Comprasnet, entre outros).
- Adapter genérico configurável por mapping declarativo.
- Testes de contrato para adapters.

### Melhorias de observabilidade
- Métricas estruturadas para Prometheus/Grafana.
- Tracing distribuído (OpenTelemetry).
- Dead-letter queue para eventos falhos (reprocessamento manual).
- Retry exponencial automático para falhas transitórias.
