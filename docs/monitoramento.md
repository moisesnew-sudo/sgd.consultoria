# Monitoramento — SGD

Guia de monitoramento, health checks, alertas inteligentes e observabilidade
do Sistema de Gestão de Demandas.

---

## 1. Health Checks

### Liveness — `GET /api/health`

Verifica se o servidor está vivo. Sem autenticação.

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2026-08-08T12:00:00.000Z",
  "uptime": 86400
}
```

### Readiness — `GET /api/health/ready`

Verifica se o servidor está pronto para receber tráfego (checa DB).

**Response (200):**
```json
{
  "status": "ready",
  "database": "connected",
  "timestamp": "2026-08-08T12:00:00.000Z"
}
```

### Health Completo — `GET /api/monitoring/health`

Health check completo com status de cada componente.

**Response (200):**
```json
{
  "status": "healthy",
  "components": {
    "database": { "status": "up", "latencyMs": 5 },
    "eventBus": { "status": "up" },
    "scheduler": { "status": "running" },
    "postgresListener": { "status": "connected" }
  },
  "timestamp": "2026-08-08T12:00:00.000Z"
}
```

---

## 2. Health Status Centralizado

**Módulo:** `lib/healthStatus.ts`

Agrega o estado de todos os componentes em um único relatório:

| Componente | Fonte | Métrica |
|-----------|-------|---------|
| Database | `pg.Pool` | Conexões ativas, latência |
| Event Bus | `EventEmitter` | Listeners ativos |
| SSE | `eventBusPostgres` | Conexões LISTEN/NOTIFY |
| Scheduler | `integrationScheduler` | Rodando / parado |
| Alert Scheduler | `alertScheduler` | Rodando / parado |

---

## 3. Monitoramento de Sistema

### Snapshot — `POST /api/monitoring/snapshot`

Grava métricas do servidor (CPU, RAM, DB, demandas).

### Histórico — `GET /api/monitoring/history`

Histórico de snapshots de monitoramento.

### Dashboard — `GET /api/monitoring/system-health`

Dashboard operacional (D2.3):status dos componentes, latência, alertas ativos.

---

## 4. Métricas Coletadas

| Métrica | Fonte | Intervalo |
|---------|-------|-----------|
| CPU do servidor | `os.cpus()` | A cada snapshot |
| Memória do servidor | `os.freemem/totalmem` | A cada snapshot |
| Tempo de resposta API | `Date.now()` | A cada request |
| Conexões DB | `pg.Pool` | A cada snapshot |
| Usuários ativos | `active_sessions` | A cada snapshot |
| Total de demandas | `demands` | A cada snapshot |
| Erros 24h | `integration_logs` | A cada sync |
| Latência de integrações | `last_response_ms` | A cada sync |

---

## 5. Alertas Inteligentes (R1–R10)

**Módulo:** `lib/alertEngine.ts`

O motor de alertas avalia o estado persistido por todas as rotinas
(sync manual, webhook, scheduler) e materializa alertas em `integration_alerts`.

### Regras

| Regra | Tipo | Severidade | Condição | Recuperação |
|-------|------|-----------|----------|-------------|
| R1 | `consecutive_failures` | Crítico | `consecutive_errors >= 3` | Sync bem-sucedido recente |
| R2 | `http_5xx` | Crítico | `last_http_status >= 500` e `error_count_24h >= 3` | Sync bem-sucedido recente |
| R3 | `system_inactive` | Crítico | `active = false` | Reativação administrativa |
| R4 | `error_spike` | Warning | `error_count_24h >= 5` (suprimido por R2) | — |
| R5 | `high_latency` | Warning | `last_response_ms >= 5000` | — |
| R6 | `stale_sync` | Warning | Último sync > 24h (sistemas ativos) | Sync recente |
| R7 | `unmatched_events` | Warning | ≥1 evento sem mapeamento em 24h | Evento processado |
| R8 | Recovery | — | Resolve alerta com evidência real | — |
| R9 | `auth_failure` | Crítico | `last_http_status` = 401/403 | Credencial corrigida |
| R10 | `api_unavailable` | Crítico | `last_http_status` = 0 | Conexão restaurada |

### Comportamento

- **Dedup determinística:** índice parcial UNIQUE `(system_id, type) WHERE status IN ('open','acknowledged')`
- **Coalescing:** mesma condição → atualiza ocorrências, preserva `firstDetectedAt`
- **Precedência:** R2 suprime R4; R3 suprime R6 (mesmo sintoma, regra mais grave prevalece)
- **Recovery (R8):** resolve apenas com evidência real (sync 200 + log de sucesso)
- **Segurança:** details redigidos antes de persistir (`redactSensitiveDetails`)

### Scheduler de Alertas

**Módulo:** `lib/alertScheduler.ts`

- Intervalo: 5 minutos
- `pg_advisory_lock` (chave diferente do integration scheduler) para multi-instância
- Roda `runAlertEvaluation()` do alertEngine
- Roda `runHealthEvaluation()` do healthEvaluator

### Verificação em Produção

```sql
-- Alertas ativos
SELECT system_id, type, severity, status, message, details->>'occurrences'
FROM integration_alerts
WHERE status IN ('open','acknowledged')
ORDER BY severity DESC, updated_at DESC;

-- Contagem por severidade
SELECT severity, COUNT(*)
FROM integration_alerts
WHERE status = 'open'
GROUP BY severity;
```

---

## 6. Event Bus + SSE

### Event Bus (in-process)

**Módulo:** `lib/eventBus.ts`

- EventEmitter centralizado
- Eventos tipados: `integration:synced`, `demand:status_changed`, `health:updated`
- Bridge para PostgreSQL LISTEN/NOTIFY (multi-instância)

### PostgreSQL LISTEN/NOTIFY

**Módulo:** `lib/eventBusPostgres.ts`

- Conexão dedicada para LISTEN/NOTIFY
- Backoff exponencial em reconexão
- Deduplicação de origem (evita echo)

### SSE (Server-Sent Events)

**Endpoint:** `GET /api/events/integrations`

- Stream em tempo real para o frontend
- Eventos: `integration:synced`, `demand:status_changed`
- Compression desabilitada para SSE

---

## 7. Logs Operacionais

### integration_logs

Histórico de todas as operações de integração.

```sql
-- Últimas operações
SELECT system_code, action, status, duration_ms, http_status, created_at
FROM integration_logs
ORDER BY created_at DESC
LIMIT 20;

-- Erros nas últimas 24h
SELECT system_code, COUNT(*)
FROM integration_logs
WHERE status = 'error' AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY system_code;
```

### audit_logs

Trilha de auditoria completa.

```sql
-- Últimas ações
SELECT entity_type, action, user_name, created_at
FROM audit_logs
ORDER BY created_at DESC
LIMIT 20;
```

---

## 8. Cleanup Periódico

**Módulo:** `server.ts` → `runCleanup()`

| Dados | Retenção | Frequência |
|-------|----------|-----------|
| `active_sessions` inativas | 24 horas | A cada startup |
| `login_attempts` | 48 horas | A cada startup |
| `token_blacklist` expirados | Até expirar | A cada startup |
| `refresh_tokens` expirados | Até expirar | A cada startup |
| `audit_logs` | 180 dias | A cada startup |
| `monitoring_logs` | 30 dias | A cada startup |
| `export_logs` | 90 dias | A cada startup |
| `integration_alerts` resolvidos | 90 dias | A cada startup |

---

## 9. Métricas para Prometheus/Grafana (Futuro)

Atualmente não exporta métricas Prometheus. Estrutura atual:

- `monitoring_logs` — snapshots periódicos (CPU, RAM, DB)
- `integration_logs` — latência, HTTP status, erros
- `integration_alerts` — alertas ativos por severidade

**Próximos passos:**
- Exportar métricas via `/metrics` endpoint
- Integrar com Grafana dashboards
- Alertas externos (email, Slack)
