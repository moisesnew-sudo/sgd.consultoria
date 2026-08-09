# Operação em Produção — SGD

**Versão:** 2.0.0 | **Data:** Agosto 2026 | **Status:** Guia Operacional

---

## 1. Arquitetura de Deploy

```
┌─────────────────────────────────────────────────┐
│                   CDN (Vercel)                   │
│            Frontend React 19 + Vite              │
└─────────────────────┬───────────────────────────┘
                      │ HTTPS
┌─────────────────────▼───────────────────────────┐
│              Render (Backend)                    │
│          Express + TypeScript + pg               │
│         ┌───────────────────────────┐            │
│         │      Pool de Conexão      │            │
│         │    max: 10, timeout: 30s  │            │
│         └─────────────┬─────────────┘            │
└───────────────────────┼─────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────┐
│              PostgreSQL 16 (Render)              │
│         30 tabelas, port 5433 externo            │
└─────────────────────────────────────────────────┘
```

---

## 2. Variáveis de Ambiente Críticas

| Variável | Exemplo | Onde |
|----------|---------|------|
| DATABASE_URL | `postgresql://user:pass@host:5433/sgd` | Render |
| JWT_SECRET | `chave-secreta-minimo-32chars` | Render |
| CORS_ORIGIN | `https://seu-app.vercel.app` | Render |
| NODE_ENV | `production` | Render |
| VITE_API_URL | `https://seu-backend.onrender.com` | Vercel |
| OUTBOUND_WEBHOOK_SECRET_{id} | `segredo-do-webhook` | Render |

---

## 3. Health Check

### Endpoint

```
GET /api/health
```

### Resposta Esperada

```json
{
  "status": "ok",
  "timestamp": "2026-08-08T12:00:00.000Z",
  "uptime": 86400,
  "version": "2.0.0",
  "database": { "status": "ok", "totalConnections": 5, "idleConnections": 4, "waitingClients": 0 },
  "postgresListener": { "status": "ok", "connected": true, "originId": "abc123" },
  "eventBus": { "status": "ok", "eventsPublished": 150, "eventsReceived": 148, "errors": 0 },
  "sse": { "status": "ok", "activeConnections": 3, "eventsSent": 450 },
  "scheduler": { "status": "ok", "active": true, "lastRunAt": "2026-08-08T12:00:00.000Z" }
}
```

### Status Possíveis

| Status | Significado | Ação |
|--------|-------------|------|
| `ok` | Todos os componentes saudáveis | Nenhuma |
| `degraded` | 1+ componente degradado | Investigar logs |
| `down` | 1+ componente inoperante | Emergência |

---

## 4. Alertas e Notificações

### Regras de Alerta

| Regra | Severidade | Condição | Ação |
|-------|-----------|----------|------|
| R1 | 🔴 Critical | 3+ erros consecutivos | Verificar sistema |
| R2 | 🔴 Critical | HTTP 5xx + 3+ erros/24h | Verificar API externa |
| R3 | 🔴 Critical | Sistema inativo | Reativar |
| R4 | 🟡 Warning | 5+ erros/24h | Monitorar |
| R5 | 🟡 Warning | Latência > 5s | Otimizar |
| R6 | 🟡 Warning | Sync > 24h sem atualização | Verificar scheduler |
| R7 | 🟡 Warning | Eventos não mapeados | Revisar config |
| R9 | 🔴 Critical | HTTP 401/403 | Verificar credenciais |
| R10 | 🔴 Critical | HTTP 0 (indisponível) | Verificar conectividade |

### Recovery

Todos os alertas requerem **evidência real** de recuperação. Um alerta nunca é resolvido por ausência de dados.

---

## 5. Operações de Rotina

### 5.1 Verificar Status Diário

```bash
# Health check
curl -s https://seu-backend.onrender.com/api/health | jq '.status'

# Alertas ativos
curl -s -H "Authorization: Bearer $TOKEN" https://seu-backend.onrender.com/api/alerts?status=open
```

### 5.2 Verificar Webhooks

```bash
# Entregas recentes
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://seu-backend.onrender.com/api/webhooks/deliveries?limit=10"
```

### 5.3 Monitorar Integrações

```bash
# Status dos 3 sistemas
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://seu-backend.onrender.com/api/integration-systems" | jq '.[].name'
```

---

## 6. Troubleshooting

### Problema: Alto uso de CPU

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| Health `degraded` | Scheduler sobrecarregado | Verificar se sync está muito frequente |
| Respostas lentas | Pool de conexão esgotado | Verificar `waitingClients` no health |

### Problema: Alertas R1 (consecutive_failures)

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| 3+ erros seguidos | API externa fora do ar | Verificar status da API, aguardar recovery |
| 3+ erros seguidos | Credenciais expiradas | Verificar variáveis de ambiente |
| 3+ erros seguidos | Rede instável | Verificar conectividade do Render |

### Problema: Alertas R9 (auth_failure)

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| HTTP 401 | Token expirado ou inválido | Renovar credenciais |
| HTTP 403 | Permissão insuficiente | Verificar escopo da integração |

### Problema: Webhooks não entregues

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| Status `retrying` | Endpoint temporariamente indisponível | Aguardar retry automático |
| Status `dead_letter` | Endpoint inoperante | Verificar URL, retry manual |
| HMAC inválido | Secret incorreto | Verificar `OUTBOUND_WEBHOOK_SECRET_{id}` |

### Problema: SSE não conecta

| Sintoma | Causa provável | Solução |
|---------|---------------|---------|
| Conexão fecha imediatamente | JWT expirado | Renovar token |
| Sem eventos | Nenhum evento recente | Verificar se demandas existem |

---

## 7. Procedure de Emergência

### 7.1 Backend Fora do Ar (Render)

1. Verificar logs no Render Dashboard
2. Verificar se PostgreSQL está acessível
3. Se DB OK mas app crashando: reiniciar serviço
4. Se DB inacessível: contactar suporte Render
5. Monitorar health check para confirmar recovery

### 7.2 Alerta Critical Ativo

1. Identificar regra (R1-R10) via `GET /api/alerts?status=open`
2. Verificar componente afetado
3. Aplicar correção correspondente (ver Troubleshooting)
4. Aguardar recovery automático (evidência real)
5. Confirmar resolução em `GET /api/alerts?status=open`

### 7.3 Webhook Dead Letter

1. Verificar endpoint destino (`GET /api/webhooks?active=true`)
2. Confirmar se endpoint está operacional
3. Retry manual: `POST /api/webhooks/deliveries/{id}/retry`
4. Se endpoint persistente: desativar webhook

### 7.4 Dados Corrompidos

1. NÃO alterar dados manualmente
2. Verificar logs de auditoria
3. Restaurar backup mais recente se necessário
4. Reportar incidente

---

## 8. Métricas de Performance

### Indicadores Esperados

| Métrica | Valor Esperado | Alerta |
|---------|---------------|--------|
| Uptime | 99.9% | < 99.5% |
| Latência média | < 500ms | > 2000ms |
| Erros 5xx | 0/dia | > 3/dia |
| Pool connections | < 8 ativos | > 8 ativos |
| Webhook delivery | > 99% | < 95% |

### Endpoints de Métricas

```
GET /api/health              → Status geral
GET /api/alerts              → Alertas ativos
GET /api/webhooks/deliveries → Entregas de webhook
GET /api/integration-systems → Status de integrações
```

---

## 9. Backup e Restore

### Backup Automático

- PostgreSQL no Render: backup diário automático
- Retenção: 7 dias (padrão Render)
- Custo: incluído no plano

### Restore

1. Acessar Render Dashboard → PostgreSQL → Backups
2. Selecionar data do backup
3. Confirmar restore
4. Verificar health check após restore

---

## 10. Escalonamento

| Nível | Contato | Quando |
|-------|---------|--------|
| L1 | Equipe SGD | Alertas warning, dúvidas operacionais |
| L2 | Tech Lead | Alertas critical, incidentes maiores |
| L3 | Suporte Render | Infraestrutura, DB, rede |
| L4 | SERPRO | Integrações governamentais |
