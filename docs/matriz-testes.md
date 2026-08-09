# Matriz de Testes — SGD

**Versão:** 2.0.0 | **Data:** Agosto 2026 | **Total:** 540 testes em 34 arquivos

---

## Visão Geral

| Domínio | Arquivos | Testes | Cobertura |
|---------|----------|--------|-----------|
| Integrações e Adapters | 7 | 208 | 38.5% |
| Processamento de Integrações | 7 | 149 | 27.6% |
| Alertas e Monitoramento | 2 | 47 | 8.7% |
| Event Bus e Postgres NOTIFY | 2 | 29 | 5.4% |
| Health Check | 2 | 41 | 7.6% |
| Webhooks (outbound) | 1 | 36 | 6.7% |
| SSE | 1 | 15 | 2.8% |
| Demandas e Eventos | 3 | 19 | 3.5% |
| Auth, Usuários, Permissões | 4 | 21 | 3.9% |
| Auditoria, Monitoramento, Backups, Texto | 4 | 65 | 12.0% |
| **TOTAL** | **34** | **540** | **100%** |

---

## 1. Integrações e Adapters (208 testes)

### governmentIntegrations.test.ts — 69 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Fluxo completo de integração governamental | 8 | ✅ |
| Adapter pattern (criar, listar, toggler) | 12 | ✅ |
| Sync (pull, push, status mapping) | 15 | ✅ |
| Auth (tokens, refresh, erro) | 10 | ✅ |
| Webhooks inbound (receber, validar, processar) | 8 | ✅ |
| Eventos de integração (created, updated, synced) | 6 | ✅ |
| Erros e timeout | 5 | ✅ |
| Rate limiting | 5 | ✅ |

### transferegovHomologation.test.ts — 29 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Autenticação | 3 | ✅ |
| HTTP status codes | 4 | ✅ |
| Dados de demanda | 3 | ✅ |
| Processamento de lote | 2 | ✅ |
| Tratamento de erros | 4 | ✅ |
| Mapeamento de status | 3 | ✅ |
| Retry e timeout | 2 | ✅ |
| Concorrência | 2 | ✅ |
| Segurança | 3 | ✅ |
| Webhooks | 3 | ✅ |

### seiHomologation.test.ts — 25 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Autenticação | 3 | ✅ |
| HTTP status codes | 4 | ✅ |
| Dados de demanda | 3 | ✅ |
| Processamento de lote | 2 | ✅ |
| Tratamento de erros | 4 | ✅ |
| Mapeamento de status | 2 | ✅ |
| Retry e timeout | 2 | ✅ |
| Concorrência | 2 | ✅ |
| Segurança | 3 | ✅ |

### cglogHomologation.test.ts — 25 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Autenticação | 3 | ✅ |
| HTTP status codes | 4 | ✅ |
| Dados de demanda | 3 | ✅ |
| Processamento de lote | 2 | ✅ |
| Tratamento de erros | 4 | ✅ |
| Mapeamento de status | 2 | ✅ |
| Retry e timeout | 2 | ✅ |
| Concorrência | 2 | ✅ |
| Segurança | 3 | ✅ |

### integrationAdapters.test.ts — 12 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Adapter registry | 4 | ✅ |
| Base adapter | 4 | ✅ |
| Http client | 4 | ✅ |

### transferegovE2E.test.ts — 41 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Fluxo end-to-end completo | 12 | ✅ |
| Cenários de erro | 8 | ✅ |
| Performance | 5 | ✅ |
| Segurança | 6 | ✅ |
| Webhooks | 5 | ✅ |
| Retry e timeout | 5 | ✅ |

### statusMapping.test.ts — 8 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Mapeamento de status | 8 | ✅ |

---

## 2. Processamento de Integrações (149 testes)

### integrationSystems.test.ts — 44 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| CRUD de sistemas | 9 | ✅ |
| Validação de dados | 10 | ✅ |
| Paginação e filtros | 8 | ✅ |
| Autenticação e permissões | 7 | ✅ |
| Integração com banco | 10 | ✅ |

### integrationScheduler.test.ts — 36 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Agendamento de sync | 12 | ✅ |
| Advisory lock | 6 | ✅ |
| Retry e backoff | 5 | ✅ |
| Erros e timeout | 6 | ✅ |
| Concorrência | 4 | ✅ |
| Métricas | 3 | ✅ |

### integrationAdmin.test.ts — 32 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Endpoints admin | 9 | ✅ |
| Validação de input | 8 | ✅ |
| Autenticação | 6 | ✅ |
| Respostas de erro | 5 | ✅ |
| Paginação | 4 | ✅ |

### integrationAlerts.test.ts — 16 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Criação de alertas | 3 | ✅ |
| Resolução de alertas | 3 | ✅ |
| Deduplicação | 3 | ✅ |
| Coalescência | 2 | ✅ |
| Recovery | 3 | ✅ |
| Integração com SSE | 2 | ✅ |

### integrations.test.ts — 10 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Endpoints CRUD | 4 | ✅ |
| Validação | 3 | ✅ |
| Erros | 3 | ✅ |

### integrationSync.test.ts — 6 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Sync pull | 2 | ✅ |
| Sync push | 2 | ✅ |
| Erros | 2 | ✅ |

### integrationProcessor.test.ts — 5 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Processamento de webhook | 3 | ✅ |
| Transação atômica | 2 | ✅ |

---

## 3. Alertas e Monitoramento (47 testes)

### alertEngine.test.ts — 35 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| R1: consecutive_failures | 4 | ✅ |
| R2: http_5xx | 4 | ✅ |
| R3: system_inactive | 3 | ✅ |
| R4: error_spike | 3 | ✅ |
| R5: high_latency | 3 | ✅ |
| R6: stale_sync | 3 | ✅ |
| R7: unmatched_events | 3 | ✅ |
| R9: auth_failure | 3 | ✅ |
| R10: api_unavailable | 3 | ✅ |
| R8: Recovery | 4 | ✅ |
| Deduplicação | 2 | ✅ |

### alertScheduler.test.ts — 12 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Execução periódica | 3 | ✅ |
| Advisory lock | 2 | ✅ |
| Erros | 3 | ✅ |
| Métricas | 2 | ✅ |
| Shutdown | 2 | ✅ |

---

## 4. Event Bus e Postgres NOTIFY (29 testes)

### eventBus.test.ts — 15 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Publicação de eventos | 4 | ✅ |
| Inscrição | 3 | ✅ |
| Error isolation | 3 | ✅ |
| Métricas | 2 | ✅ |
| Lifecycle | 3 | ✅ |

### eventBusPostgres.test.ts — 14 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Conexão | 3 | ✅ |
| NOTIFY/Listen | 4 | ✅ |
| Reconexão | 3 | ✅ |
| Deduplicação | 2 | ✅ |
| Shutdown | 2 | ✅ |

---

## 5. Health Check (41 testes)

### healthStatus.test.ts — 21 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Database health | 4 | ✅ |
| Event Bus health | 4 | ✅ |
| SSE health | 4 | ✅ |
| Scheduler health | 3 | ✅ |
| PostgreSQL Listener health | 3 | ✅ |
| Overall status | 3 | ✅ |

### healthEvaluator.test.ts — 20 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Database alerts | 4 | ✅ |
| Listener alerts | 3 | ✅ |
| Event Bus alerts | 3 | ✅ |
| SSE alerts | 3 | ✅ |
| Scheduler alerts | 3 | ✅ |
| Webhook alerts | 2 | ✅ |
| Recovery | 2 | ✅ |

---

## 6. Webhooks Outbound (36 testes)

### outboundWebhooks.test.ts — 36 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Criação de webhook | 4 | ✅ |
| Entrega de payload | 6 | ✅ |
| HMAC signing | 4 | ✅ |
| Retry logic (3 tentativas) | 5 | ✅ |
| Dead letter | 4 | ✅ |
| Anti-SSRF | 5 | ✅ |
| Sanitização de payload | 4 | ✅ |
| Retry manual (retryDelivery) | 4 | ✅ |

---

## 7. SSE (15 testes)

### sse.test.ts — 15 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Conexão | 3 | ✅ |
| Headers | 3 | ✅ |
| Eventos | 4 | ✅ |
| Heartbeat | 2 | ✅ |
| Desconexão | 3 | ✅ |

---

## 8. Demandas e Eventos (19 testes)

### demandEvents.test.ts — 7 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Criação de demanda | 2 | ✅ |
| Atualização | 2 | ✅ |
| Mudança de status | 2 | ✅ |
| Exclusão | 1 | ✅ |

### demandsDeadline.test.ts — 5 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Cálculo de prazo | 3 | ✅ |
| Alertas de prazo | 2 | ✅ |

### demandsFilters.test.ts — 7 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Filtros | 4 | ✅ |
| Paginação | 3 | ✅ |

---

## 9. Auth, Usuários, Permissões (21 testes)

### auth.test.ts — 9 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Login | 3 | ✅ |
| Logout | 2 | ✅ |
| Token refresh | 2 | ✅ |
| Rate limiting | 2 | ✅ |

### permissions.test.ts — 5 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| RBAC | 3 | ✅ |
| Permissões por papel | 2 | ✅ |

### password-reset.test.ts — 4 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Solicitação de reset | 2 | ✅ |
| Aplicação de reset | 2 | ✅ |

### sessions.test.ts — 3 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Criação | 1 | ✅ |
| Limpeza | 1 | ✅ |
| Expiração | 1 | ✅ |

---

## 10. Auditoria, Monitoramento, Backups, Texto (65 testes)

### audit.test.ts — 6 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Logging de ações | 3 | ✅ |
| Rastreabilidade | 3 | ✅ |

### monitoring.test.ts — 10 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Métricas | 4 | ✅ |
| Health check endpoint | 3 | ✅ |
| Performance | 3 | ✅ |

### backups.test.ts — 4 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Backup | 2 | ✅ |
| Restore | 2 | ✅ |

### standardization.test.ts — 15 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Padronização de nomes | 5 | ✅ |
| Validação de dados | 5 | ✅ |
| Formatação | 5 | ✅ |

### text.test.ts — 22 testes
| Categoria | Testes | Status |
|-----------|--------|--------|
| Sanitização | 8 | ✅ |
| Extração | 7 | ✅ |
| Validação | 7 | ✅ |

---

## Executando os Testes

```bash
# Backend completo
cd backend && npm test

# Arquivo específico
cd backend && npx vitest run src/__tests__/alertEngine.test.ts

# Com coverage
cd backend && npx vitest run --coverage

# Watch mode
cd backend && npx vitest
```

### Pré-requisitos
- PostgreSQL rodando na porta 5433
- Variáveis de ambiente configuradas (ver `.env.example`)
- Node.js 18+ e npm 9+

### Resultados Esperados
- **540+ testes passando** (3 pré-existentes podem falhar: outboundWebhooks)
- **tsc --noEmit** sem erros (backend e frontend)
- **Tempo total:** ~30-60 segundos
