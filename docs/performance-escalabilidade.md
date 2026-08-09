# Performance, Escalabilidade e Alta Disponibilidade — SGD

**Fase:** F2.2 | **Data:** Agosto 2026

Guia institucional das capacidades de performance, escalabilidade e alta
disponibilidade do Sistema de Gestão de Demandas. Complementa
[`performance-audit.md`](./performance-audit.md) (auditoria de gargalos e metas SLO).

---

## 1. Visão Geral

O SGD opera de forma stateless para HTTP sobre PostgreSQL, permitindo réplicas
horizontais. O estado distribuído é garantido pelo banco:

- **SSE multi-instância:** `LISTEN/NOTIFY` (Postgres) retransmite eventos para todas as réplicas.
- **Workers de fila concorrentes:** claim atômico via `FOR UPDATE SKIP LOCKED` — N workers processam a mesma fila sem duplicar jobs.
- **Escalonamento por configuração:** tudo é controlado por variáveis de ambiente (sem rebuild).

Componentes novos (F2.2):
`lib/cache.ts`, `lib/jobQueue.ts`, `middleware/rateLimit.ts`,
métricas em `lib/healthStatus.ts`.

---

## 2. Cache em Memória (`lib/cache.ts`)

Armazena agregados e listas estáveis para reduzir carga no banco.

- **TTL por grupo** (padrão: `CACHE_TTL_DEFAULT` 30s; stats/overview configuráveis por ENV).
- **Invalidação proativa:** eventos do event bus (demand.created, demand.updated, sync.*) invalidam chaves afetadas.
- **Limite de chaves** (`CACHE_MAX_KEYS`, padrão 1000) — proteção contra crescimento ilimitado.
- **Registro de métricas** de hit/miss no health report.

| Grupo | Uso |
|-------|-----|
| `dashboards` | Stats e overview institucional |
| `lists` | Listagens estáveis (municípios, órgãos, sistemas) |
| `integration_*` | Estado de sincronização e status de sistemas |

**Nota:** cache em memória é por réplica. Para consistência estrita entre
instâncias, evolução prevista é Redis (o design já isola o provedor).

---

## 3. Fila Assíncrona (`lib/jobQueue.ts` + tabela `background_jobs`)

Move trabalho não-crítico para segundo plano, desacoplando a resposta HTTP.

- **Persistência:** jobs ficam em `background_jobs` (PostgreSQL) — sobrevivem a restart.
- **Retry/backoff:** `max_attempts` (padrão 3) com backoff exponencial + jitter (base 1s, teto 5min).
- **Concorrência:** processamento em lote (`JOB_QUEUE_CONCURRENCY`, padrão 3) por ciclo.
- **Intervalo:** `JOB_QUEUE_INTERVAL_MS` (padrão 5000).
- **Métricas:** pending, running, retrying, succeeded, failed, lastError no health report.

**Quem usa:** envio de webhooks outbound, sincronização de integrações e trabalhos
pesados que hoje rodariam em linha.

---

## 4. Rate Limit Institucional (`middleware/rateLimit.ts`)

Política por identidade, aplicada após autenticação (JWT via cookie):

| Identidade | Limite (padrão) | Janela |
|------------|-----------------|--------|
| Anônimo (por IP) | 120 | 15 min |
| Autenticado (por usuário) | 600 | 15 min |
| Admin (role admin) | 2000 | 15 min |

- Headers padrão `RateLimit-*` + `X-RateLimit-*` habilitados.
- Bloqueios registrados em métricas (`rateLimit.blockedRequests`) e em log.
- Webhooks externos (HMAC) e `/health` possuem tratamento dedicado (fora desta política).

---

## 5. Observabilidade de Performance

Todas as métricas abaixo são expostas em `GET /api/monitoring/health` (admin)
e `GET /api/health`:

| Bloco | Métricas |
|-------|----------|
| `api` | totalRequests, errors4xx, errors5xx, averageResponseTime, slowRequests, slowRequestCount, status |
| `database` | activeConnections, idleConnections, poolTotal, poolSaturation, slowQueries, queryTimeMs, status |
| `cache` | hits, misses, hitRate, keys, evictions |
| `rateLimit` | blockedRequests, lastBlockedAt, lastBlockedIp |
| `jobQueue` | pending, running, succeeded, failed, retrying, lastError |

O `lib/healthEvaluator.ts` classifica o estado em `healthy | degraded | down`
e dispara alertas (regras D1) quando degradado — ex.: 5xx > 5%, pool > 90%,
fila pendente com erro, latência média elevada.

---

## 6. Alta Disponibilidade e Backup

- **Probe de liveness:** `GET /api/health` — sem dependências.
- **Probe de readiness:** `GET /api/health/ready` — verifica conexão com o banco.
- **Health completo:** `GET /api/monitoring/health` — componentes + métricas de performance.
- **Backup:** agendado (`backups`), com hash SHA-256 e retenção configurável.
- **Escalonamento:** réplicas adicionais na frente do mesmo PostgreSQL; workers de fila
  adicionais são seguros pelo claim `FOR UPDATE SKIP LOCKED`.

---

## 7. Referência de Configuração (ENV)

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `CACHE_TTL_DEFAULT` | 30000 | TTL base do cache (ms) |
| `CACHE_TTL_DASHBOARD` | 30000 | TTL de dashboards/stats (ms) |
| `CACHE_MAX_KEYS` | 1000 | Limite de chaves no cache |
| `JOB_QUEUE_INTERVAL_MS` | 5000 | Intervalo do worker de fila |
| `JOB_QUEUE_CONCURRENCY` | 3 | Jobs processados por ciclo |
| `JOB_QUEUE_CLEANUP_DAYS` | 30 | Retenção de histórico concluído |
| `RATE_LIMIT_ANON_MAX` | 120 | Limite anônimo/15min |
| `RATE_LIMIT_USER_MAX` | 600 | Limite autenticado/15min |
| `RATE_LIMIT_ADMIN_MAX` | 2000 | Limite admin/15min |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Janela (15 min) |
| `WEBHOOK_RATE_LIMIT_MAX` | 1000 | Limite webhook/15min |

---

## 8. Roadmap de Evolução

1. Cache distribuído (Redis) para hit rate consistente entre réplicas.
2. Rate limit distribuído (Redis) para política global.
3. Consultas com paginação por cursor em listagens de alto volume.
4. Particionamento temporal de `audit_logs`/`monitoring_logs`.
5. Métricas Prometheus (`/metrics`) para coleta em nível de infraestrutura.
