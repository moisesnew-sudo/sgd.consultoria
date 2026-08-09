# Segurança do SGD

Documento técnico de segurança — controles, políticas e boas práticas
implementadas no Sistema de Gestão de Demandas.

---

## 1. Visão Geral

O SGD adota uma abordagem de **defesa em profundidade** com múltiplas camadas
de proteção: autenticação, autorização, proteção de transporte, sanitização
de dados, controle de acesso e auditoria completa.

---

## 2. Autenticação (JWT)

### Tokens

| Tipo | Validade | Armazenamento |
|------|----------|---------------|
| Access Token | 15 minutos | Cookie HTTP-only + Secure |
| Refresh Token | 7 dias | Cookie HTTP-only + Secure |
| CSRF Token | Sessão | Cookie (não HTTP-only) + Header |

### Configuração

| Parâmetro | Valor |
|-----------|-------|
| Secret | `JWT_SECRET` (≥32 caracteres, validado no startup) |
| Refresh Secret | `JWT_REFRESH_SECRET` (fallback: `JWT_SECRET_refresh`) |
| Algoritmo | HS256 |
| Cookie Domain | `gruposgd.com.br` (produção) |
| SameSite | `lax` |
| Secure | `true` (produção) |

### Payload do Access Token

```json
{
  "id": 1,
  "email": "admin@sgd.gov.br",
  "name": "Administrador SGD",
  "role": "admin",
  "permissions": ["demands.view", "demands.create", "..."]
}
```

### Segurança de Tokens

- **Blacklist:** tokens revogados são armazenados como SHA-256 em `token_blacklist`
- **Cleanup:** blacklist é limpa a cada 15 minutos
- **Refresh rotation:** novo refresh token a cada uso, com family tracking
- **Replay detection:** refresh token reutilizado invalida toda a family
- **Password history:** últimas 5 senhas verificadas na alteração
- **Account lockout:** 5 tentativas falhas → bloqueio por 15 minutos

---

## 3. CSRF Protection

### Mecanismo

1. Login gera cookie `csrf_token` (não HTTP-only, SameSite=lax)
2. Frontend inclui header `X-CSRF-Token` em requisições de escrita
3. Backend compara header com cookie — divergência → 403

### Exceções

- Métodos seguros (GET, HEAD, OPTIONS) são isentos
- Rotas `/api/auth/*` e `/api/password-reset/*` são isentas
- Webhooks (`/api/integrations/webhooks`) são isentos (HMAC exclusivo)

---

## 4. Helmet (Headers de Segurança)

| Header | Valor |
|--------|-------|
| Content-Security-Policy | production: sem `unsafe-eval` |
| Strict-Transport-Security | max-age=31536000; includeSubDomains; preload |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| X-XSS-Protection | 1; mode=block |
| Referrer-Policy | strict-origin-when-cross-origin |

---

## 5. CORS

| Configuração | Valor |
|-------------|-------|
| Origin | `CORS_ORIGIN` (comma-separated) |
| Credentials | `true` |
| Methods | GET, POST, PUT, DELETE, PATCH |
| Allowed Headers | Content-Type, Authorization, X-CSRF-Token |
| Exposed Headers | X-Request-Id |
| Wildcard `*` | **Rejeitado** em produção (server exits) |
| Empty origin | **Rejeitado** em produção |

**Origins permitidas (produção):**
```
https://gruposgd.com.br
https://www.gruposgd.com.br
http://localhost:3000
```

---

## 6. Rate Limiting

| Limiter | Janela | Máximo | Aplicado a |
|---------|--------|--------|------------|
| `authLimiter` | 15 min | 20 req | `/api/auth/login` |
| `passwordResetLimiter` | 1 hora | 3 req | `/api/password-reset/request` |
| `apiLimiter` | 15 min | 200 req | `/api/*` (todas as rotas API) |
| `webhookLimiter` | 15 min | 1000 req | `/api/integrations/webhooks` |

- Headers padrão habilitados, headers legados desabilitados
- `apiLimiter` ignora webhooks e health checks

---

## 7. RBAC — Controle de Acesso Baseado em Papéis

### Papéis

| Papel | Descrição | Nível |
|-------|-----------|-------|
| `admin` / `administrador` | Acesso total (bypass de permissões) | Máximo |
| `gestor` | Gerenciamento de demandas e usuários | Alto |
| `diretor` | Mesmo nível do gestor | Alto |
| `analista` | Criação e edição de demandas | Médio |
| `tecnico` | Mesmo nível do analista | Médio |
| `consulta` | Apenas visualização | Baixo |
| `parceiro` | Visualização + relatórios | Baixo |
| `cliente` | Apenas visualização | Mínimo |
| `visitante` | Apenas dashboard | Mínimo |

### Permissões Granulares

| Permissão | Categoria |
|-----------|-----------|
| `dashboard.view` | Dashboard |
| `demands.view`, `create`, `edit`, `delete` | Demandas |
| `demands.export_excel`, `export_pdf` | Exportação |
| `reports.view`, `emit`, `print`, `export` | Relatórios |
| `users.view`, `create`, `edit`, `delete` | Usuários |
| `users.manage_permissions` | Permissões |
| `settings.view`, `edit` | Configurações |
| `audit.view`, `dashboard`, `export` | Auditoria |
| `sessions.view`, `terminate` | Sessões |
| `backups.view`, `create`, `restore` | Backups |
| `monitoring.view` | Monitoramento |
| `lgpd.view` | LGPD |
| `integrations.view`, `manage`, `sync`, `admin` | Integrações |

### Verificação

```
requirePermission(key)
  → admin/administrador: bypass (concede tudo)
  → demais: verifica user_permissions + role_permissions
  → sem permissão: 403
```

---

## 8. Webhook Authentication (HMAC-SHA256)

### Mecanismo

1. Sistema externo envia `POST /webhooks/:system`
2. Headers obrigatórios:
   - `X-Signature` — HMAC-SHA256 de `timestamp\n[idempotency-key]\nbody`
   - `X-Timestamp` — timestamp ISO (janela anti-replay: 5 minutos)
   - `X-Idempotency-Key` — chave de idempotência
3. Secret lido de `process.env[secret_env_key]` (nunca persistido no banco)
4. Validação: `crypto.timingSafeEqual` (previne timing attacks)

### Segredo

- Comprimento mínimo: 16 caracteres
- Armazenado como variável de ambiente (`TRANSFEREGOV_WEBHOOK_SECRET`, `SEI_WEBHOOK_SECRET`, `CGLOG_WEBHOOK_SECRET`)
- Nunca em banco de dados, logs ou config

---

## 9. Gerenciamento de Segredos

### Princípios

1. **Nunca persistir segredos no banco** — `secret_env_key` referencia env var
2. **Redaction** — `sanitizeIntegrationConfig()` redige chaves sensíveis para `[REDACTED]`
3. **Visibilidade por permissão** — apenas `integrations.manage` (ou admin) vê valores reais
4. **Merge seguro** — `mergeIntegrationConfig()` preserva segredos em atualizações parciais
5. **Sentinela** — `[REDACTED]` (backend) e `********` (frontend) nunca são persistidos

### Chaves Sensíveis (regex)

```
/(secret|token|password|passwd|api_key|private_key|authorization|credential)/i
```

---

## 10. Proteção SSRF

- `fetch()` usa `AbortController` com timeout configurável (padrão: 30s)
- `baseUrl` validado por sistema — endpoints não são arbitrários
- Webhooks: somente POST em rotas pré-definidas (`/webhooks/:system`)
- Integrações: endpoints construídos a partir de `config.baseUrl` (não user input)

---

## 11. Logs Seguros

### Sanitização de Headers

```typescript
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization', 'x-api-key', 'cookie',
  'set-cookie', 'x-auth-token',
]);
// Valores → '[REDACTED]' em logs
```

### Sanitização de Config

```typescript
sanitizeIntegrationConfig(config, canViewSecrets = false)
// canViewSecrets = false → valores sensíveis → '[REDACTED]'
// canViewSecrets = true  → valores reais (apenas integrations.manage)
```

### Logger

- Nível configurável via `LOG_LEVEL`
- Timestamps ISO 8601
- Nunca loga: senhas, tokens, credenciais, payloads completos com dados sensíveis

---

## 12. Upload de Arquivos

- **Multer** para parsing multipart
- Validação de tipo MIME
- Hash SHA-256 do conteúdo (integridade)
- Armazenamento no banco (metadados) + sistema de arquivos
- Soft delete (deleted_at)

---

## 13. Criptografia

| Uso | Algoritmo |
|-----|-----------|
| Senhas | bcrypt (salt rounds: 10) |
| Tokens JWT | HS256 (HMAC-SHA256) |
| Webhooks | HMAC-SHA256 |
| Backups | SHA-256 (hash de integridade) |
| Blacklist tokens | SHA-256 (hash do token) |
| Refresh tokens | SHA-256 (hash armazenado) |

---

## 14. Políticas de Segurança

### Startup Validation

```
validateEnv():
  - JWT_SECRET ≥ 32 caracteres
  - JWT_SECRET ≠ default values
  - DATABASE_URL definido
  - CORS_ORIGIN definido (não vazio)
```

### Cleanup Periódico (retention policy)

| Dados | Retenção |
|-------|----------|
| Sessões inativas | 24 horas |
| Tentativas de login | 48 horas |
| Token blacklist | Até expirar |
| Refresh tokens | Até expirar |
| Audit logs | 180 dias |
| Monitoring logs | 30 dias |
| Export logs | 90 dias |
| Alertas resolvidos | 90 dias |

---

## 15. Conformidade (LGPD)

- Dashboard LGPD (`/api/lgpd/dashboard`) para visão de conformidade
- Dados pessoais identificados: usuários (email, nome), demandas (município)
- Soft delete preserva integridade referencial
- Auditoria completa de todas as ações de escrita
- Logs de exportação rastreáveis
- Princípio do menor privilégio em todas as camadas
