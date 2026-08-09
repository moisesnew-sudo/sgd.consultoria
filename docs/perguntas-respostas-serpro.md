# Perguntas e Respostas — SERPRO

Documento de preparação para apresentação técnica do SGD junto à equipe do SERPRO.

---

## 1. Arquitetura

### "Como o sistema suporta múltiplas integrações governamentais?"

O SGD utiliza uma arquitetura de **adapters** com contrato padronizado:

```
GovernmentIntegrationAdapter
  ├── authenticate(config) → credential
  ├── fetch(config, credential, params) → ExternalApiResponse
  ├── validate(payload) → true | string
  ├── normalize(payload) → NormalizedIntegrationEvent
  └── sync(config, params) → SyncPullResult
```

- **AdapterRegistry** mapeia código do sistema → adapter
- **Scheduler** executa sync periódica para todos os sistemas ativos
- **Processor** persiste resultados de forma atômica

Novos sistemas integram implementando a interface `GovernmentIntegrationAdapter` — não é necessário modificar o código existente.

---

### "Como é feita a normalização de dados de sistemas diferentes?"

Cada adapter converte o payload bruto em `NormalizedIntegrationEvent`:

```typescript
{
  systemCode: string;        // "transferegov" | "sei" | "cglog"
  eventType: string;         // "proposta.atualizada"
  proposalNumber?: string;   // número da proposta (lookup)
  externalId?: string;       // ID externo (convênio, NUP, protocolo)
  externalStatus?: string;   // status normalizado (CAIXA ALTA)
  deadline?: string;         // ISO 8601
  extra?: Record<string, unknown>;
}
```

O motor de sincronização (`integrationSync.ts`) aplica o mapeamento de status externo → interno via `integration_status_mapping` (configurável por admin).

---

### "Como o sistema lida com falhas de rede ou APIs indisponíveis?"

**Timeout:** configurable por requisição (padrão: 30s)
**Retry:** backoff exponencial com jitter (até 3 tentativas)
**Status elegíveis para retry:** 408, 429, 500, 502, 503, 504
**Circuit breaker:** erros consecutivos incrementam `consecutive_errors` → alerta R1

Em falha, o `sync()` retorna `httpStatus` e `authError`, alimentando alertas R9/R10.

---

### "Como funciona a sincronização periódica?"

- `integrationScheduler.ts` usa `pg_advisory_lock` (chave exclusiva) para execução única
- A cada minuto, verifica quais sistemas ativos precisam de sync
- Respeita `syncIntervalMinutes` por sistema
- Em sucesso: atualiza `last_sync_at`, limpa erros consecutivos
- Em falha: incrementa `consecutive_errors`, registra `last_http_status`

Multi-instância seguro: apenas uma instância executa o ciclo por vez.

---

## 2. Segurança

### "Como são tratados tokens e senhas?"

| Uso | Armazenamento | Algoritmo |
|-----|---------------|-----------|
| Senhas | `users.password_hash` | bcrypt (salt: 10) |
| JWT Access | Cookie HTTP-only + Secure | HS256, 15min |
| JWT Refresh | Cookie HTTP-only + Secure | HS256, 7 dias |
| CSRF | Cookie + Header | Token aleatório |
| Webhook secrets | Variável de ambiente | HMAC-SHA256 |
| Refresh tokens | `refresh_tokens.token_hash` | SHA-256 |
| Blacklist | `token_blacklist.token_hash` | SHA-256 |

**Nenhum segredo é persistido em banco de dados.** `secret_env_key` referencia variável de ambiente.

---

### "Como ocorre auditoria?"

Toda ação de escrita gera registro em `audit_logs`:

```sql
{
  entity_type: "demand",
  entity_id: "DMN-123456",
  action: "demand.updated",
  user_id: 1,
  user_name: "Administrador SGD",
  details: { changes: { status: "analise" } },
  _ip: "192.168.1.1",
  _browser: "Chrome/120",
  _os: "Windows 11"
}
```

**Retenção:** 180 dias (configurável)
**Índices:** (entity_type, entity_id), created_at
**Consulta:** `GET /api/audit` com filtros por data, usuário, ação

---

### "Como são controlados acessos?"

**RBAC (Role-Based Access Control):**

| Papel | Exemplo de permissão |
|-------|---------------------|
| admin | bypass total |
| gestor | demands.create, users.manage |
| analista | demands.create, demands.edit |
| consulta | demands.view |

**Permissões granulares:** 30+ permissões por categoria (Demandas, Relatórios, Usuários, Auditoria, Integrações)

**Verificação:** `requirePermission(key)` em cada rota — admin bypass automaticamente

**CSRF:** token em header `X-CSRF-Token` comparado com cookie — exceto GET e webhooks

---

### "Como é protegido o tráfego?"

| Controle | Configuração |
|----------|-------------|
| HTTPS | Obrigatório em produção |
| Helmet | HSTS (1 ano), CSP, X-Frame-Options: DENY |
| CORS | Origin whitelist (não wildcard) |
| Rate Limit | 20 req/15min (auth), 200 req/15min (API) |
| CSRF | Token por sessão, validação em escrita |

---

## 3. Disponibilidade

### "Como o sistema detecta falhas?"

**Health checks:**
- `GET /api/health` — liveness (está vivo?)
- `GET /api/health/ready` — readiness (DB conectado?)
- `GET /api/monitoring/health` — componentes (DB, Event Bus, Scheduler)

**Componentes monitorados:**
- Database (pool de conexões)
- Event Bus (listeners ativos)
- PostgreSQL LISTEN/NOTIFY (SSE)
- Scheduler (executando)
- Alert Scheduler (executando)

---

### "Como trata indisponibilidade de sistemas externos?"

**Alertas automáticos:**
- R9 `auth_failure` → HTTP 401/403 → "revise credenciais"
- R10 `api_unavailable` → HTTP 0 → "API fora do ar"
- R1 `consecutive_failures` → erros ≥ 3 → "sistema com problema"

**Recuperação (R8):**
- Resolve alerta SOMENTE com evidência real (sync 200 + log de sucesso)
- Não resolve por ausência de dados

**Comportamento degradado:**
- Sistema continua operando para demandas existentes
- Novas integrações ficam pendentes até recuperação
- Logs registram todas as tentativas

---

### "Existe retry para chamadas externas?"

Sim. Configuração:

| Parâmetro | Padrão |
|-----------|--------|
| `maxRetries` | 3 |
| `retryBaseDelayMs` | 1000 |
| `timeoutMs` | 30000 |
| Status retryáveis | 408, 429, 500, 502, 503, 504 |

**Backoff exponencial com jitter:** delay cresce exponencialmente + aleatoriedade para evitar thundering herd.

**429 (rate limit):** respeita `Retry-After` quando disponível.

---

## 4. Escalabilidade

### "Quantos sistemas podem ser integrados?"

**Ilimitados.** A arquitetura é extensível:

1. Criar arquivo `novo-sistema.adapter.ts`
2. Implementar `GovernmentIntegrationAdapter`
3. Registrar em `adapterRegistry.ts`
4. Adicionar mapeamento de status em `integration_status_mapping`
5. Seed do sistema em `seed.ts`

Scheduler, processor, admin e dashboards são compartilhados automaticamente.

---

### "Como adicionar novos órgãos ou sistemas?"

**Via interface admin:**
1. Acesse "Integrações" → "Sistemas"
2. Clique "Novo Sistema"
3. Preencha: code, name, secret_env_key, config JSONB
4. Ative o sistema

**Config JSONB exemplo:**
```json
{
  "baseUrl": "https://api.novosistema.gov.br",
  "secretEnvKey": "NOVO_SISTEMA_TOKEN",
  "authType": "token",
  "syncEnabled": true,
  "syncIntervalMinutes": 60,
  "maxRecordsPerSync": 100,
  "timeoutMs": 30000,
  "maxRetries": 3
}
```

---

### "Como o sistema lida com múltiplas instâncias?"

**pg_advisory_lock:** chave exclusiva por scheduler (738291046 para sync, outra para alertas)
- Apenas uma instância executa por vez
- Se a instância falhar, outra assume

**PostgreSQL LISTEN/NOTIFY:** bridge para SSE multi-instância
- Conexão dedicada por instância
- Backoff exponencial em reconexão
- Deduplicação de origem

**Stateless:** tokens em cookies, sessões em banco — qualquer instância serve qualquer request.

---

## 5. Dados

### "Como é feito backup?"

- **Automático:** Render Managed Database (backups diários)
- **Manual:** `POST /api/backups` → gera arquivo com SHA-256
- **Verificação:** `POST /api/backups/:id/verify` → compara hash
- **Restauração:** `POST /api/backups/:id/restore` → sobrescreve dados atuais

---

### "Como é feita a retenção de dados?"

| Dados | Retenção |
|-------|----------|
| Audit logs | 180 dias |
| Monitoring logs | 30 dias |
| Export logs | 90 dias |
| Alertas resolvidos | 90 dias |
| Sessões inativas | 24 horas |
| Login attempts | 48 horas |
| Webhook events | Permanente |
| Demand versions | Permanente |

Cleanup executado a cada startup do servidor.

---

### "O sistema suporta multi-tenant?"

Sim. Coluna `tenant_id` (DEFAULT 1) presente em:
demands, users, municipalities, audit_logs, integration_systems, etc.

**Isolamento:** queries filtram por `tenant_id` (configurável por middleware).
**Pronto para:** múltiplos órgãos compartilhando a mesma instância.

---

## 6. Conformidade

### "O sistema atende à LGPD?"

| Princípio | Implementação |
|-----------|---------------|
| Minimização | Coleta apenas dados necessários |
| Finalidade | Dados usados apenas para gestão de demandas |
| Controle | Usuários visualizam seus dados |
| Segurança | Criptografia, RBAC, auditoria |
| Transparência | Logs de exportação rastreáveis |

**Dashboard LGPD:** `GET /api/lgpd/dashboard` — visão de conformidade.

---

### "Como é feita a auditoria para órgãos de controle?"

- **Trilha completa:** toda ação de escrita → `audit_logs`
- **Integrações:** `integration_logs` com HTTP status, duração, triggered_by
- **Exportações:** `export_logs` com formato, quantidade, data
- **Backups:** hash SHA-256 para verificação de integridade
- **Consulta:** API paginada com filtros (`GET /api/audit`)

---

## 7. Performance

### "Qual a capacidade do sistema?"

| Métrica | Valor |
|---------|-------|
| Pool de conexões DB | 10 (padrão pg) |
| Timeout de requisição | 30s (configurável) |
| Rate limit API | 200 req/15min |
| Rate limit webhooks | 1000 req/15min |
| Tamanho máximo de upload | 10MB |
| Latência típica API | < 200ms |

---

### "Como é monitorada a performance?"

- **monitoring_logs:** snapshots de CPU, RAM, DB (configurável)
- **integration_logs:** latência de cada operação de integração
- **healthStatus:** status de cada componente
- **alertEngine:** alertas R5 (latência > 5s) e R1 (falhas consecutivas)

---

## 8. Deploy

### "Como é feito o deploy?"

**Backend (Render.com):**
- Push na branch `main` → build automático
- `npm install && npm run build` (TypeScript)
- `npm start` (servidor inicia)
- Health check: `GET /api/health`

**Frontend (Vercel):**
- Push na branch `main` → build automático
- `tsc && vite build` (TypeScript + bundle)
- Deploy no domínio `gruposgd.com.br`

**Rollback:** Via dashboard (Render/Vercel) — selecione deploy anterior.

---

### "Quais são os pré-requisitos de infraestrutura?"

| Componente | Requisito |
|-----------|-----------|
| Backend | Node.js 18+, 512MB RAM |
| Database | PostgreSQL 16, 1GB+ |
| Frontend | Estático (Vercel) |
| Domínio | HTTPS obrigatório |
| Secrets | Gerenciador de segredos (env vars) |
