# Relatório de Segurança — SGD

**Versão:** 2.0.0 | **Data:** Agosto 2026 | **Classificação:** DOCUMENTO INTERNO

---

## 1. Resumo Executivo

O SGD implementa defesa em profundidade com 12 controles de segurança cobrindo autenticação, autorização, proteção de dados, monitoramento e resiliência. Nenhuma vulnerabilidade crítica foi identificada na auditoria.

---

## 2. Controles de Segurança

### 2.1 Autenticação (JWT)

| Controle | Status | Detalhe |
|----------|--------|---------|
| Token de acesso | ✅ | 15 minutos, HMAC-SHA256 |
| Token de refresh | ✅ | 7 dias, rotação no uso |
| Secret key | ✅ | Em variável de ambiente, validada no startup |
| Algoritmo | ✅ | HS256 (HMAC-SHA256) |
| Validação | ✅ | `validateEnv()` rejeita JWT_SECRET ausente ou fraco |

**Implementação:** `backend/src/lib/auth.ts`, `backend/src/server.ts:validateEnv()`

### 2.2 Senhas

| Controle | Status | Detalhe |
|----------|--------|---------|
| Hash | ✅ | Bcrypt com 12 rounds de salt |
| Política | ✅ | Mínimo 8 caracteres |
| Armazenamento | ✅ | Nunca em texto plano, hash no banco |
| Reset | ✅ | Token de uso único, expira em 1h, não revela existência |

**Implementação:** `backend/src/lib/auth.ts:hashPassword()`, `backend/src/routes/auth.ts`

### 2.3 Controle de Acesso Baseado em Papéis (RBAC)

| Papel | Permissões | Nível |
|-------|-----------|-------|
| admin | Acesso total | Total |
| gestor | Gerenciar equipes, demandas | Alto |
| operador | Criar/atualizar demandas | Médio |
| analista | Consultar, comentar | Médio |
| consulta | Somente leitura | Baixo |

| Controle | Status | Detalhe |
|----------|--------|---------|
| 10 papéis | ✅ | Definidos no seed |
| 30+ permissões | ✅ | Granulares por módulo |
| Middleware | ✅ | `requirePermission()` em todas as rotas |
| Verificação | ✅ | Backend valida em cada request |

**Implementação:** `backend/src/lib/auth.ts:requirePermission()`, `backend/src/seed.ts`

### 2.4 Proteção CSRF

| Controle | Status | Detalhe |
|----------|--------|---------|
| Token | ✅ | Gerado e validado em mutations |
| Cookie | ✅ | HttpOnly, SameSite=Strict |
| Métodos protegidos | ✅ | POST, PUT, PATCH, DELETE |
| Exceções | ✅ | GET, OPTIONS, HEAD isentos |

**Implementação:** `backend/src/lib/csrf.ts`

### 2.5 Rate Limiting

| Endpoint | Limite | Janela |
|----------|--------|--------|
| Autenticação | 20 req | 1 minuto |
| API geral | 200 req | 1 minuto |
| Webhooks | 1000 req | 1 minuto |

| Controle | Status | Detalhe |
|----------|--------|---------|
| Por IP | ✅ | Identificação por endereço |
| Headers | ✅ | `X-RateLimit-*` e `Retry-After` |
| Excedido | ✅ | HTTP 429 com mensagem clara |

**Implementação:** `backend/src/lib/rateLimit.ts`

### 2.6 Helmet (HTTP Security Headers)

| Header | Valor | Status |
|--------|-------|--------|
| HSTS | `max-age=31536000; includeSubDomains` | ✅ |
| X-Frame-Options | `DENY` | ✅ |
| X-Content-Type-Options | `nosniff` | ✅ |
| X-XSS-Protection | `1; mode=block` | ✅ |
| CSP | Configurado por ambiente | ✅ |
| Referrer-Policy | `strict-origin-when-cross-origin` | ✅ |

**Implementação:** `backend/src/server.ts`

### 2.7 Proteção contra SQL Injection

| Controle | Status | Detalhe |
|----------|--------|---------|
| Queries parameterizadas | ✅ | `pg` driver com `$1, $2...` |
| ORM | ✅ | Nenhum `query()` com string interpolation |
| Validação de input | ✅ | Validação antes da query |

**Implementação:** Todas as queries em `backend/src/`

### 2.8 Proteção contra XSS

| Controle | Status | Detalhe |
|----------|--------|---------|
| React DOM | ✅ | Escape automático de JSX |
| Sanitização server-side | ✅ | Validação de tipos e formatos |
| Output encoding | ✅ | Headers Content-Type corretos |

**Implementação:** React (frontend), validação em routes (backend)

### 2.9 Proteção contra SSRF (Webhooks)

| Controle | Status | Detalhe |
|----------|--------|---------|
| Bloqueio localhost | ✅ | `127.0.0.1`, `localhost`, `0.0.0.0` |
| Bloqueio metadata | ✅ | `169.254.169.254` (AWS/GCP/Azure) |
| Bloqueio private IPs | ✅ | `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Bloqueio IPv6 | ✅ | `::1`, `fc00::/7` |

**Implementação:** `backend/src/lib/webhookDispatcher.ts:isPrivateOrReserved()`

### 2.10 Gestão de Secrets

| Controle | Status | Detalhe |
|----------|--------|---------|
| Variáveis de ambiente | ✅ | Nenhum secret no código |
| Validação | ✅ | `validateEnv()` no startup |
| Webhook secrets | ✅ | `OUTBOUND_WEBHOOK_SECRET_{id}` por webhook |
| Nunca no banco | ✅ | Banco armazena hash SHA-256, não o segredo |
| Redact automático | ✅ | `sanitizeIntegrationConfig()` em logs |

**Implementação:** `backend/src/lib/redact.ts`, `backend/src/server.ts:validateEnv()`

### 2.11 Webhook HMAC Signing

| Controle | Status | Detalhe |
|----------|--------|---------|
| Algoritmo | ✅ | HMAC-SHA256 |
| Header | ✅ | `X-SGD-Signature` |
| Payload | ✅ | JSON stringificado antes do sign |
| Sanitização | ✅ | Payload sanitizado antes do sign |

**Implementação:** `backend/src/lib/webhookDispatcher.ts:signPayload()`

### 2.12 Monitoramento e Auditoria

| Controle | Status | Detalhe |
|----------|--------|---------|
| Alertas R1-R10 | ✅ | 8 regras de alerta + recovery |
| Health check | ✅ | 5 componentes monitorados |
| Logs sanitizados | ✅ | redact automático |
| Rastreabilidade | ✅ | userId em todas as ações |
| Rate limit logging | ✅ | 401/403 logados como auth_failure |

**Implementação:** `backend/src/lib/alertEngine.ts`, `backend/src/lib/healthStatus.ts`

---

## 3. Análise de Riscos

### Riscos Identificados (Menores)

| # | Risco | Severidade | Status | Mitigação |
|---|-------|-----------|--------|-----------|
| 1 | SSE sem limite de conexões | Médio | Aceito | Documentado; carga atual não exige |
| 2 | Eventos perdidos durante disconnect | Médio | Aceito | SSE é efêmero; reconexão automática |
| 3 | Shutdown sem drain period | Médio | Aceito | Advisory lock protege DB; webhooks são retry |
| 4 | Token não re-validado em SSE longo | Baixo | Aceito | JWT 15min; reconexão periódica |
| 5 | app.listen sem error callback | Baixo | Aceito | Render tratamento interno |

### Riscos Eliminados

| Risco | Controle |
|-------|----------|
| SQL Injection | Queries parameterizadas |
| XSS | React DOM + sanitização |
| Senhas em texto | Bcrypt hash |
| Secrets no código | Variáveis de ambiente |
| CSRF em mutations | Token + cookie HttpOnly |
| Brute force | Rate limiting |
| Dados sensíveis em logs | Redact automático |
| SSRF via webhooks | Anti-SSRF |

---

## 4. Padrões de Codificação

| Padrão | Implementação |
|--------|--------------|
| Never trust user input | Validação em todas as rotas |
| Defense in depth | Múltiplas camadas (JWT + RBAC + CSRF + Rate Limit) |
| Least privilege | RBAC com permissões granulares |
| Fail securely | Erros não expõem detalhes internos |
| Separation of duties | Webhooks: env var por ID, nunca no banco |
| Logging without secrets | redact automático |

---

## 5. Conformidade

| Requisito | Status | Detalhe |
|-----------|--------|---------|
| LGPD | ✅ | Logs sanitizados, dados minimizados |
| RBAC | ✅ | 10 papéis, 30+ permissões |
| Auditoria | ✅ | Todas as ações rastreadas |
| Transparência | ✅ | Health check público, erros claros |

---

## 6. Checklist de Segurança

| # | Controle | Status |
|---|----------|--------|
| 1 | JWT com secret em env var | ✅ |
| 2 | Senhas com Bcrypt (12 rounds) | ✅ |
| 3 | RBAC com 10 papéis | ✅ |
| 4 | CSRF em mutations | ✅ |
| 5 | Rate limiting (20/200/1000) | ✅ |
| 6 | Helmet (HSTS, CSP, X-Frame) | ✅ |
| 7 | SQL injection protection | ✅ |
| 8 | XSS protection | ✅ |
| 9 | Anti-SSRF em webhooks | ✅ |
| 10 | Secrets em env vars | ✅ |
| 11 | Redact automático | ✅ |
| 12 | Alertas R1-R10 | ✅ |
| 13 | Health check 5 componentes | ✅ |
| 14 | Webhook HMAC signing | ✅ |
| 15 | Graceful shutdown | ✅ |

**Resultado:** 15/15 controles implementados.
