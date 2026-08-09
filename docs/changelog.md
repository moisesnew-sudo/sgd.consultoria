# Changelog — SGD

Linha evolutiva do Sistema de Gestão de Demandas.

---

## F2.2 — Performance, Escalabilidade e Alta Disponibilidade Institucional

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Garantir performance sustentável, escalabilidade horizontal e resiliência
institucional do SGD sob carga.

### Implementação
- `docs/performance-audit.md` — Auditoria de 7 gargalos (indexação, pool, cache, rate limit, trabalho assíncrono, payload, observabilidade) com metas SLO
- `docs/performance-escalabilidade.md` — Guia de cache, fila assíncrona, rate limit institucional, observabilidade e alta disponibilidade
- `lib/cache.ts` — Cache em memória com TTL, invalidação por eventos, limite de chaves e métricas hit/miss
- `lib/jobQueue.ts` + tabela `background_jobs` — Fila assíncrona persistida (retry/backoff exponencial, claim `FOR UPDATE SKIP LOCKED`, worker distribuído, auditoria e métricas)
- `middleware/rateLimit.ts` — Rate limit institucional por identidade (anônimo 120, usuário 600, admin 2000 por 15min) com headers `RateLimit-*`/`X-RateLimit-*`
- `lib/healthStatus.ts` / `lib/healthEvaluator.ts` — Métricas de API (4xx/5xx, latência, lentidão), pool, cache, rate limit e job queue no health report
- `server.ts` — Wiring dos limiters, métricas e worker de fila; `express.json({ limit: '10mb' })`
- `docs/banco-dados.md` — Documentação da tabela `background_jobs` e índices
- `performanceScaling.test.ts` — 12 testes cobrindo rate limit, cache, job queue e health

### Auditoria
- 3 falhas pré-existentes em `outboundWebhooks.test.ts` (expectativa de 403 para gestor vs. seed com permissão `integrations.admin`) — corrigido: `integrations.admin` removida do perfil gestor no seed, com reconciliação idempotente de `role_permissions`/`user_permissions` (fonte de verdade do seed preservando ajustes individuais)
- Todos os demais testes verdes

### Impacto
Sistema com fila assíncrona, cache, política de limite justa por identidade e
observabilidade de performance — pronto para picos institucionais e escala horizontal.

---

## F1.3 — Homologação Institucional

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Preparar o SGD para avaliação institucional completa — consolidar evidências técnicas, operacionais e de segurança.

### Implementação
- `docs/checklist-homologacao.md` — 53 itens de verificação (infra, auth, segurança, integrações, alertas, health, testes, operação)
- `docs/matriz-testes.md` — 540 testes em 34 arquivos, 14 categorias
- `docs/relatorio-seguranca.md` — 15 controles de segurança, análise de riscos, conformidade LGPD
- `docs/operacao-producao.md` — Guia operacional completo (deploy, health, alertas, troubleshooting, emergência)
- `docs/termo-entrega-sgd.md` — Documento de entrega institucional com 10 critérios de aceitação
- `docs/changelog.md` — Esta linha evolutiva

### Auditoria Técnica
- 14 pontos de integração auditados (server, event bus, postgres listener, alert engine, health, SSE, webhooks, 3 adapters, testes, shutdown)
- 6 riscos menores identificados (nenhum crítico)
- Todos os controles de segurança validados

### Impacto
Sistema pronto para homologação institucional e auditoria externa. Documentação completa para avaliação por terceiros.

---

## F1.1 — Documentação Técnica Institucional

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Criar documentação técnica oficial do SGD, preparada para apresentação institucional.

### Implementação
- `docs/arquitetura.md` — Visão geral, diagramas Mermaid, componentes, fluxos
- `docs/integracoes.md` — Arquitetura de integrações governamentais (atualizado)
- `docs/seguranca.md` — JWT, CSRF, Helmet, CORS, RBAC, secrets, SSRF
- `docs/banco-dados.md` — Schema completo das 30 tabelas
- `docs/APIs.md` — Todos os endpoints documentados
- `docs/deploy.md` — Render, Vercel, variáveis, troubleshooting
- `docs/monitoramento.md` — Health checks, alertas R1–R10, Event Bus
- `docs/auditoria.md` — Compliance, LGPD, rastreabilidade
- `docs/manual-administrador.md` — Guia operacional
- `docs/changelog.md` — Esta linha evolutiva

### Impacto
Documentação permite que um novo técnico compreenda a arquitetura do SGD sem consultar código-fonte.

---

## E3.3 — Integração Governamental CGLOG Enterprise

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Integrar o CGLOG ao mesmo ciclo operacional do Transferegov e SEI.

### Implementação
- `cglog.adapter.ts` — `sync()` retorna `httpStatus`/`authError` em falhas
- `cglogHomologation.test.ts` — 25 testes (18 categorias obrigatórias)
- Docs: `homologacao.md` (env vars CGLOG), `integracoes.md` (626 testes)

### Impacto
CGLOG operacional na mesma arquitetura, com observabilidade R9/R10, sem fluxo paralelo.

---

## E3.2 — Integração Governamental SEI

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Integrar o SEI ao mesmo ciclo operacional do Transferegov.

### Implementação
- `sei.adapter.ts` — `sync()` retorna `httpStatus`/`authError` em falhas
- `seiHomologation.test.ts` — 25 testes (18 categorias obrigatórias)
- Docs: `homologacao.md` (env vars SEI, config JSONB), `integracoes.md` (601 testes)

### Impacto
SEI operacional na mesma arquitetura, com observabilidade R9/R10, sem fluxo paralelo.

---

## E3.1 — Gestão Operacional de Integrações

**Data:** Agosto 2026 | **Status:** Concluído

### Objetivo
Painel administrativo para operação de integrações (overview, sync manual, teste de conexão).

### Implementação
- `integrationAdmin.ts` — `getOverview()`, `testConnection()`, `runManualSyncWithLock()`
- Rotas: `GET /overview`, `POST /test-connection`
- Frontend: `IntegrationOperationsView.tsx`, `IntegrationAdminView.tsx` (aba Operações)
- `integrationAdminApi` no frontend

### Impacto
Operadores podem monitorar e operar integrações sem acesso ao banco de dados.

---

## E2.2 — Homologação Transferegov

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Levar a integração com o Transferegov à produção (homologação institucional).

### Implementação
- Alertas R9 (`auth_failure`) e R10 (`api_unavailable`) no alertEngine
- Persistência de `last_http_status` em falhas de sync periódica
- Testes de homologação (`transferegovHomologation.test.ts`)
- Documentação operacional (`docs/homologacao.md`)

### Impacto
Transferegov operacional em produção com observabilidade completa.

---

## E2.1 — Integração End-to-End Transferegov

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Fluxo completo: webhook → normalização → persistência → timeline → auditoria.

### Implementação
- `transferegov.adapter.ts` — autenticação, fetch, validação, normalização, sync
- `integrationProcessor.ts` — persistência atômica (transaction)
- `integrationSync.ts` — motor de normalização
- `webhookAuth.ts` — HMAC-SHA256
- Testes E2E (`transferegovE2E.test.ts`)

### Impacto
Primeira integração governamental operacional de ponta a ponta.

---

## E1.3 — Dashboard Operacional de Sincronização

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Dashboard para visualização do status de sincronização de todas as integrações.

### Implementação
- `IntegrationSyncView.tsx` — status, intervalo, histórico, falhas
- `getSyncStatus()` no backend
- Dados consolidados de todos os sistemas

### Impacto
Visibilidade em tempo real da saúde das sincronizações.

---

## E1.2 — Scheduler Periódico Multi-instância

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Sincronização pull periódica com sistemas governamentais, seguro para múltiplas instâncias.

### Implementação
- `integrationScheduler.ts` — `pg_advisory_lock` (chave exclusiva)
- Config por sistema: `syncEnabled`, `syncIntervalMinutes`, `maxRecordsPerSync`
- Registro de sucesso/falha em `integration_systems` e `integration_logs`
- Controle de erros consecutivos

### Impacto
Sincronização automática sem race conditions entre instâncias.

---

## E1.1 — Camada GovernmentIntegrationAdapter

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Contrato padronizado para comunicação com APIs governamentais.

### Implementação
- `types.ts` — `GovernmentIntegrationAdapter` (authenticate, fetch, validate, sync)
- `httpClient.ts` — timeout, retry, backoff exponencial, logging sanitizado
- `adapterRegistry.ts` — registro central de adapters

### Impacto
Novos sistemas podem ser integrados implementando uma única interface.

---

## D3 — Webhooks e Integrações Externas

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Webhooks outbound para notificar sistemas externos sobre eventos do SGD.

### Implementação
- `webhookDispatcher.ts` — entrega assíncrona, HMAC signing, retry
- `outbound_webhooks` — configuração de endpoints
- `webhook_deliveries` — log de entregas
- Admin CRUD + teste de webhook

### Impacto
Sistemas externos podem reagir a eventos do SGD em tempo real.

---

## D2 — Observabilidade e Health Monitoring

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Monitoramento completo da saúde do sistema.

### Implementação
- `healthStatus.ts` — status centralizado de todos os componentes
- `healthEvaluator.ts` — avaliação de condições
- `monitoring.ts` — snapshots periódicos (CPU, RAM, DB)
- `GET /api/monitoring/system-health` — dashboard operacional

### Impacto
Operadores podem identificar e resolver problemas antes que afetem usuários.

---

## D1 — Alert & Real-Time

**Data:** Julho 2026 | **Status:** Concluído

### Objetivo
Sistema de alertas inteligentes e notificações em tempo real.

### Implementação
- `alertEngine.ts` — regras R1–R8 (dedup, coalescing, recovery)
- `alertScheduler.ts` — avaliação periódica (5 min)
- `eventBus.ts` — publicação de eventos
- `eventBusPostgres.ts` — LISTEN/NOTIFY multi-instância
- SSE (`/api/events/integrations`) — stream para frontend
- `integration_alerts` — persistência de alertas

### Impacto
Notificações em tempo real e alertas automáticos para problemas operacionais.

---

## Fase 0 — Fundação

**Data:** Junho 2026 | **Status:** Concluído

### Objetivo
Core do SGD: demandas, usuários, autenticação, frontend funcional.

### Implementação
- Backend Express + PostgreSQL
- Frontend React + Tailwind
- CRUD de demandas com timeline
- Autenticação JWT + RBAC
- Upload de anexos
- Municípios (validação IBGE)
- Relatórios (PDF, Excel)
- Auditoria básica
- Seed de dados iniciais

### Impacto
Sistema funcional para gestão de demandas de órgãos públicos.
