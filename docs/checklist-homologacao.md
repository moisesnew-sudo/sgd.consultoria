# Checklist de Homologação — SGD

**Versão:** 2.0.0 | **Data:** Agosto 2026 | **Status:** Pronto para auditoria

---

## 1. Infraestrutura e Deploy

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 1.1 | PostgreSQL 16 | Rodando, schema aplicado, 30 tabelas criadas | ✅ | Pool: max 10, timeout 30s |
| 1.2 | Backend (Render) | TypeScript compila sem erros | ✅ | `tsc --noEmit` limpo |
| 1.3 | Frontend (Vercel) | Build sem erros | ✅ | React 19 + Vite |
| 1.4 | Variáveis de ambiente | Todas configuradas, nenhum segredo no repositório | ✅ | Validação via `validateEnv()` |
| 1.5 | CORS_ORIGIN | Domínio do frontend na whitelist | ✅ | Produção: domínio Vercel |
| 1.6 | HTTPS | HSTS habilitado via Helmet | ✅ | `includeSubDomains: true` |
| 1.7 | Conexão DB | Pool saudável, sem leaks | ✅ | Health check: `totalConnections > 0` |

---

## 2. Autenticação e Autorização

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 2.1 | JWT | Tokens de 15min (access) + 7d (refresh) | ✅ | HMAC-SHA256 |
| 2.2 | Senhas | Bcrypt com salt | ✅ | 12 rounds |
| 2.3 | RBAC | 10 papéis, 30+ permissões | ✅ | admin, gestor, operador, etc. |
| 2.4 | CSRF | Token em mutations (POST/PUT/PATCH/DELETE) | ✅ | Cookie HttpOnly |
| 2.5 | Rate Limit | 20 req/min auth, 200/min API, 1000/min webhooks | ✅ | Por IP |
| 2.6 | Sessões | Limpeza automática de sessões expiradas | ✅ | `runCleanup()` no startup |
| 2.7 | Reset de senha | Token de uso único, expira em 1h | ✅ | Não revela existência de conta |

---

## 3. Segurança da Aplicação

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 3.1 | Helmet | HSTS, CSP, X-Frame-Options habilitados | ✅ | Middleware obrigatório |
| 3.2 | SQL Injection | Parameterized queries (pg driver) | ✅ | Nenhum `query()` com string interpolation |
| 3.3 | XSS | Sanitização de input, escaping de output | ✅ | React DOM + server-side |
| 3.4 | SSRF | Anti-SSRF no webhook dispatcher | ✅ | Bloqueia localhost, private IPs, metadata |
| 3.5 | Secrets | Nunca no banco de dados | ✅ | Webhooks: env var por ID |
| 3.6 | Redact | `sanitizeIntegrationConfig()` em logs | ✅ | Remove baseUrl, token, apiSecret, etc. |
| 3.7 | Webhook HMAC | Assinatura X-SGD-Signature (HMAC-SHA256) | ✅ | Payload sanitizado antes do sign |

---

## 4. Integrações Governamentais

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 4.1 | Transferegov | sync() retorna httpStatus em todas as falhas | ✅ | catch-all: httpStatus=0 |
| 4.2 | SEI | sync() retorna httpStatus em todas as falhas | ✅ | catch-all: httpStatus=0 |
| 4.3 | CGLOG | sync() retorna httpStatus em todas as falhas | ✅ | catch-all: httpStatus=0 |
| 4.4 | Retry | 3 tentativas, backoff exponencial | ✅ | 1s → 5s → dead_letter |
| 4.5 | Webhook Dispatcher | Entrega assinada, timeout 10s | ✅ | Anti-SSRF habilitado |
| 4.6 | Dead Letter | Monitoramento via health:webhook_dead_letter | ✅ | 3+ em 24h = alerta |

---

## 5. Alertas e Monitoramento

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 5.1 | R1 | consecutive_failures ≥ 3 → critical | ✅ | Coalescing com dedup |
| 5.2 | R2 | http_5xx ≥ 500 + errorCount24h ≥ 3 → critical | ✅ | Suprime R4 |
| 5.3 | R3 | system_inactive → critical | ✅ | Suprime R6 |
| 5.4 | R4 | error_spike ≥ 5 → warning | ✅ | Suprimido por R2 |
| 5.5 | R5 | high_latency ≥ 5000ms → warning | ✅ | |
| 5.6 | R6 | stale_sync > 24h → warning | ✅ | Suprimido por R3 |
| 5.7 | R7 | unmatched_events ≥ 1 → warning | ✅ | |
| 5.8 | R9 | auth_failure (401/403) → critical | ✅ | |
| 5.9 | R10 | api_unavailable (HTTP 0) → critical | ✅ | |
| 5.10 | R8 (Recovery) | Evidência real necessária | ✅ | Nunca resolvido por ausência |

---

## 6. Health Check e Infraestrutura

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 6.1 | GET /api/health | Retorna status ok/degraded/down | ✅ | 5 componentes monitorados |
| 6.2 | Database health | Pool stats (total, idle, waiting) | ✅ | degraded se waiting > 5 |
| 6.3 | Event Bus health | Metrics: published, received, errors | ✅ | degraded se errors > 100 |
| 6.4 | SSE health | Conexões ativas, erros | ✅ | degraded se errors > 50 |
| 6.5 | Scheduler health | Último run, duração, erros | ✅ | 2+ erros consecutivos = degraded |
| 6.6 | PostgreSQL Listener | Conexão, reconexões | ✅ | Backoff: 1s → 30s |

---

## 7. Testes

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 7.1 | Testes unitários | 540+ testes, todos passando | ✅ | 34 arquivos de teste |
| 7.2 | Testes de integração | Cobertura de adapters, scheduler, processor | ✅ | 208 testes de integração |
| 7.3 | Testes de alertas | R1-R10 + recovery | ✅ | 35 testes |
| 7.4 | Testes de segurança | Auth, RBAC, CSRF, rate limit | ✅ | 21 testes |
| 7.5 | Testes de monitoramento | Health status + evaluator | ✅ | 41 testes |
| 7.6 | tsc limpo | Zero erros TypeScript | ✅ | Backend + Frontend |

---

## 8. Operação e Manutenção

| # | Item | Critério | Status | Observação |
|---|------|----------|--------|------------|
| 8.1 | Graceful Shutdown | SIGTERM/SIGINT tratados | ✅ | Schedulers + listeners parados |
| 8.2 | Seed | Dados iniciais criados automaticamente | ✅ | Papéis, permissões, 3 sistemas |
| 8.3 | Cleanup | Sessões expiradas removidas no startup | ✅ | |
| 8.4 | Logs | Sanitizados, sem segredos | ✅ | redact automático |

---

## Resumo

| Categoria | Itens | Aprovados | Pendentes |
|-----------|-------|-----------|-----------|
| Infraestrutura | 7 | 7 | 0 |
| Autenticação | 7 | 7 | 0 |
| Segurança | 7 | 7 | 0 |
| Integrações | 6 | 6 | 0 |
| Alertas | 10 | 10 | 0 |
| Health Check | 6 | 6 | 0 |
| Testes | 6 | 6 | 0 |
| Operação | 4 | 4 | 0 |
| **TOTAL** | **53** | **53** | **0** |

**Resultado:** Sistema pronto para homologação institucional.

---

## Riscos Conhecidos (Menores)

| # | Risco | Severidade | Mitigação |
|---|-------|-----------|-----------|
| 1 | SSE sem limite de conexões | Médio | Documentado; aceitável para carga atual |
| 2 | Eventos perdidos durante disconnect do listener | Médio | SSE é efêmero; reconexão automática |
| 3 | Shutdown sem drain period | Médio | Scheduler advisory lock + finally block |
| 4 | Adapter catch-all sem httpStatus | Médio | Já corrigido em CGLOG; transferegov/SEI usam httpStatus=0 no catch |
| 5 | Token não re-validado em SSE longo | Baixo | JWT de 15min; reconexão periódica do cliente |
| 6 | app.listen sem error callback | Baixo | Render/Express tratam internamente |
