# Auditoria de Performance — SGD

**Fase:** F2.2 — Performance, Escalabilidade e Alta Disponibilidade Institucional
**Data:** Agosto 2026 | **Status:** Executado

Auditoria técnica dos gargalos de performance do backend SGD, com metas SLO
definidas e medição contínua via `lib/healthStatus.ts`.

---

## 1. Inventário de gargalos identificados

| # | Componente | Gargalo | Impacto | Classificação |
|---|-----------|---------|---------|---------------|
| G1 | Banco PostgreSQL | Consultas sem indexação em cenários de alto volume (demandas por status/uf/município) | Latência de listas | Médio |
| G2 | Pool de conexões | Saturação do pool sem acompanhamento (max padrão 10) | Timeouts em pico | Médio |
| G3 | Cache | Sem cache em dashboards/stats — recomputação a cada request | CPU/DB em dashboards | Alto |
| G4 | Rate limit | Política única por IP; autenticados penalizados igual anônimos | UX de operadores | Médio |
| G5 | Trabalho assíncrono | Webhooks/sincronização em linha com o request | Latência de resposta | Alto |
| G6 | Payload | Body JSON ilimitado por rota sem limiter dedicado | Exaustão de memória | Alto |
| G7 | Observabilidade | Sem métricas de API (4xx/5xx, latência, lentidão) | Cegueira operacional | Médio |

---

## 2. Correções aplicadas (F2.2)

| Gargalo | Solução | Artefato |
|---------|---------|----------|
| G3 | Cache em memória com TTL, invalidação por evento e métricas hit/miss | `lib/cache.ts` |
| G4 | Rate limit institucional por usuário/IP/admin com headers `X-RateLimit-*` | `middleware/rateLimit.ts` |
| G5 | Job queue assíncrona persistida em PostgreSQL (retry/backoff, auditoria) | `lib/jobQueue.ts` |
| G6 | `express.json({ limit: '10mb' })` + `authLimiter` + `webhookLimiter` dedicado | `server.ts` |
| G7 | Métricas de API, cache, rate limit e job queue no report de saúde | `lib/healthStatus.ts` |

---

## 3. Metas SLO institucionais

| Métrica | Alvo | Fonte de medição | Violação de SLO |
|---------|------|------------------|-----------------|
| Latência p95 de API | < 500 ms | `api.averageResponseTime` + `api.slowRequests` | `slowRequests` crescente |
| Taxa de erro 5xx | < 1% | `api.errors5xx / api.totalRequests` | `api.status = degraded` (> 5%) |
| Erros 4xx controlados | Alerta se > 5% | `api.errors4xx` | — |
| Consultas lentas | < 200 ms por query | `database.slowQueries` | `slowQueries` acumulando |
| Saturação do pool | < 90% | `database.poolSaturation` | `database.status = degraded` |
| Hit rate de cache | > 80% | `cache.hitRate` | Hit rate baixo (recomputação) |
| Bloqueios de rate limit | Monitorar picos | `rateLimit.blockedRequests` | Picos de 429 |
| Fila de jobs pendentes | Processamento < 60s | `jobQueue.pending` | Fila crescente + `lastError` |

---

## 4. Carga estimada e capacidade

| Cenário | Volume | Observação |
|---------|--------|------------|
| Operação diária | 10k requests/hora | Confortável com pool de 10 conexões |
| Pico institucional (fim de prazo) | 50k requests/hora | Requer 2+ réplicas (stateless, cache em memória por réplica) |
| Jobs assíncronos | 1k/dia | Fila PostgreSQL com retry/backoff |

Escalabilidade horizontal: o backend é stateless para HTTP; o estado distribuído
é garantido por PostgreSQL (LISTEN/NOTIFY para SSE multi-instância, `FOR UPDATE
SKIP LOCKED` para workers de fila). Cache e rate limit em memória são por réplica
(aceitável na fase atual; evolução prevista: Redis).

---

## 5. Limites e proteções

- `CACHE_MAX_KEYS` (padrão 1000) — evita crescimento ilimitado do cache em memória.
- Rate limit: anônimo 120/15min, autenticado 600/15min, admin 2000/15min (configurável por ENV).
- SSE: limite de conexões simultâneas (`maxConnections`, padrão 100) com recusa controlada.
- Body parsing limitado a 10 MB; webhooks com limiter dedicado (1000/15min).
- Job queue: `max_attempts` por job, backoff exponencial com jitter (base 1s, teto 5min).
