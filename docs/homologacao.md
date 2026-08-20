# Homologação e Produção — Integrações Governamentais (SGD)

Guia operacional das **Fases E2.2 (Transferegov), E3.2 (SEI) e E3.3 (CGLOG)**
para subir as integrações em homologação e produção. Cobre configuração de
ambiente, sincronização periódica, observabilidade (alertas R1–R10), e a
rotina de verificação pós-deploy.

> ✅ Fases E2.2/E3.2/E3.3 NÃO alteraram a arquitetura existente (adapters,
> scheduler, webhooks). Adicionaram hardening de observabilidade no motor de
> alertas (R9 `auth_failure` e R10 `api_unavailable`), passaram a persistir
> `last_http_status` nas falhas de sincronização periódica e integraram o SEI
> e o CGLOG ao mesmo ciclo operacional do Transferegov (sem fluxo paralelo).

---

## 1. Variáveis de ambiente

Nunca commitar segredos. Crie o arquivo de ambiente a partir do modelo:

```
backend/.env
```

Todas as variáveis abaixo são obrigatórias exceto onde indicado.

```ini
# --- Banco de dados -----------------------------------------------------------
PGHOST=localhost
PGPORT=5432
PGDATABASE=sgd
PGUSER=sgd_app
PGPASSWORD=<trocar em produção>

# --- API / JWT ----------------------------------------------------------------
JWT_SECRET=<64+ chars aleatórios>
JWT_REFRESH_SECRET=<diferente do acima>

# --- Frontend (URL pública) ---------------------------------------------------
WEBAPP_URL=https://sgd.homologacao.exemplo.gov.br

# --- Integrações: Transferegov -------------------------------------------------
# Base URL da API Pública de Gestão de Parcerias (pública, sem autenticação):
#   https://api-publica.transferegov.gestao.gov.br/parcerias
TRANSFEREGOV_BASE_URL=https://api-publica.transferegov.gestao.gov.br/parcerias

# Secret da integração. A chave DEFINE o nome, o VALOR fica nesta env var.
# O backend referencia por secret_env_key (nunca armazena o segredo no banco).
TRANSFEREGOV_API_KEY=dd288274-a1d1-4ba9-8d74-2ff56e2b3a3b-EXEMPLO

# --- Integrações: SEI (Fase E3.2) ----------------------------------------------
# Base URL da API do SEI (consulta de processos por NUP):
#   Homologação/Produção conforme o ambiente disponibilizado pelo órgão.
SEI_BASE_URL=https://api.sei.gov.br

# Token de integração com o SEI. O VALOR fica nesta env var.
SEI_API_TOKEN=token-de-integracao-sei-EXEMPLO

# --- Integrações: CGLOG (Fase E3.3) --------------------------------------------
# Base URL da API do CGLOG (consulta de eventos por protocolo/proposta):
#   Homologação/Produção conforme o ambiente disponibilizado pelo órgão.
CGLOG_BASE_URL=https://api.cglog.gov.br

# Token de integração com o CGLOG. O VALOR fica nesta env var.
CGLOG_API_TOKEN=token-de-integracao-cglog-EXEMPLO

# --- Scheduler de sincronização periódica ------------------------------------
# Intervalo em ms entre verificações do agendador (padrão 60_000 = 1 minuto).
INTEGRATION_SYNC_INTERVAL_MS=60000
```

### Produção vs Homologação — resumo

| Aspecto           | Homologação                       | Produção                          |
|-------------------|-----------------------------------|-----------------------------------|
| `TRANSFEREGOV_BASE_URL` | API Pública de Parcerias (`api-publica.transferegov.gestao.gov.br/parcerias`) | API Pública de Parcerias (`api-publica.transferegov.gestao.gov.br/parcerias`) |
| `SEI_BASE_URL`     | Ambiente SEI de teste do órgão     | Ambiente SEI de produção          |
| `CGLOG_BASE_URL`   | Ambiente CGLOG de teste do órgão   | Ambiente CGLOG de produção        |
| Key/secret        | Chave de sandbox                 | Chave de produção (rotação regular) |
| JWT_SECRET       | Pode ser fixo (equipe)           | 64+ bytes aleatórios, rotação |
| Monitoração      | Verificar logs/erros diariamente  | Alertas R1–R10 + dashboards |

---

## 2. Sincronização periódica (scheduler)

A rotina `integrationScheduler.ts` roda `runScheduledSyncCycle()`:

- Usa `pg_advisory_lock` (key `738291046`) para execução única multi-instância.
- Seleciona sistemas **ativos** com `config.syncEnabled === true`.
- Respeita `intervalMinutes` e `maxRecordsPerSync` por sistema.
- Em **falha** agora persiste `last_http_status` e `last_response_ms` em
  `integration_systems` (alimentando os alertas R2/R9/R10) e grava
  `integration_logs` com status `error` e `http_status`.

### Configurando a sincronização por sistema (config JSONB)

```json
{
  "syncEnabled": true,
  "syncIntervalMinutes": 60,
  "maxRecordsPerSync": 100,
  "baseUrl": "https://api-publica.transferegov.gestao.gov.br/parcerias",
  "authType": "none",
  "timeoutMs": 30000,
  "maxRetries": 3
}
```

- `syncEnabled: false` (padrão) → o scheduler ignora o sistema.
- `intervalMinutes` mínimo sensato: 30 (evita rate-limit no Transferegov).
- `maxRecordsPerSync`: volume de registros por execução.

### Configurando o SEI (Fase E3.2)

O SEI é processado pelo **mesmo** scheduler e pela mesma arquitetura do
Transferegov — sem fluxo paralelo. Diferente do Transferegov, o SEI usa o
**motor de snapshot** (`seiSnapshot.ts`): o scheduler invoca
`runSeiSnapshotSync` em vez do `govAdapter.sync`, publicando a base de
processos em `integration_snapshots` (UPSERT idempotente por NUP).

> **STATUS DO CONTRATO: INFERIDO / PENDENTE DE HOMOLOGAÇÃO.**
> Não há endpoint oficial confirmado pelo órgão. Assume-se a listagem paginada
> `GET {baseUrl}/api/v1/processos?pagina={n}&tamanho_da_pagina={m}` com envelope
> `{ data: [...], total_pages, total_items }` (padrão do Transferegov validado);
> uma resposta sem envelope (array direto) também é aceita como página única.
> **Habilitar em produção somente após a homologação do endpoint real do órgão.**

A configuração do sistema `sei` segue o mesmo formato de config JSONB:

```json
{
  "syncEnabled": true,
  "syncIntervalMinutes": 60,
  "maxRecordsPerSync": 100,
  "baseUrl": "https://api.sei.gov.br",
  "secretEnvKey": "SEI_API_TOKEN",
  "authType": "token",
  "timeoutMs": 30000,
  "maxRetries": 3
}
```

- `authType: "token"` → o fetch envia o secret no header `X-Auth-Token`
  (equivalente ao `api_key` do Transferegov).
- Identidade dos registros: `external_id` = **NUP** (`NNNNNN.NNNNNN/AAAA-XX`),
  validado pelo adapter (`sei.adapter.ts#validate`) e pelo motor; itens sem NUP
  na listagem são ignorados (não invalidam o snapshot).
- Não há endpoint de data-atualizacao confirmado: a execução sempre coleta o
  snapshot completo; o estado `SKIPPED` só ocorre por bloqueio de advisory lock
  (execução concorrente).
- Execução auditada em `integration_logs` (ação `integration.snapshot.sei`,
  `triggered_by = snapshot-sync`, `metrics.api_contract = "inferred"`).
- Em falha (HTTP 401/403, 5xx ou 0) o snapshot registra `httpStatus`/`authError`,
  alimentando os alertas R9 `auth_failure` e R10 `api_unavailable` do mesmo jeito
  que o Transferegov.
- O SEI aparece automaticamente em **Integration Operations**, **Sync Dashboard**
  e **System Health** — não há telas novas.

### Configurando o CGLOG (Fase E3.3)

> **STATUS DO CONTRATO: NÃO CONFIRMADO — integração webhook-driven apenas.**
> O CGLOG não possui contrato de consulta (polling) confirmado pelo órgão.
> Por isso **não** há motor de snapshot e o scheduler **não** executa polling:
> mesmo com `syncEnabled: true`, a guarda do scheduler registra um
> `integration_logs` de aviso ("contrato de API de consulta não confirmado"),
> atualiza `last_sync_at` e **não** incrementa `consecutive_errors` (evita
> falsos `stale_sync` e alertas em sistemas webhook-only).

Eventos chegam exclusivamente por webhook:

- `POST /api/integrations/webhooks/cglog` com HMAC-SHA256
  (`X-Signature` sobre `timestamp\n[chave-idempotencia]\nbody`, janela
  anti-replay de 5 min, secret `CGLOG_WEBHOOK_SECRET`);
- Payload exige **protocolo** ou **número de proposta**; status normalizado e
  mapeado via `integration_status_mapping` (ex.: `EM_ANALISE` → `analise`);
- Idempotente por `X-Idempotency-Key` (duplicatas respondem 200 com
  `duplicate: true` e não reprocessam).

Quando o órgão disponibilizar a API de consulta: confirmar o contrato,
implementar o motor de snapshot no padrão Transferegov/SEI e remover a guarda
do scheduler (`integrationScheduler.ts`).

---

## 3. Monitoramento — Alertas inteligentes (R1–R10)

O motor `alertEngine.ts` materializa alertas em `integration_alerts` e
funcionam desacoplados do scheduler: avaliam o estado persistido por QUALQUER
rotina (sync manual, webhook, scheduler).

| Regra | Tipo | Severidade | Condição |
|-------|------|-----------|----------|
| R1 | `consecutive_failures` | crítico | `consecutive_errors >= 3` |
| R2 | `http_5xx` | crítico | `last_http_status >= 500` e `error_count_24h >= 3` |
| R3 | `system_inactive` | crítico | sistema `active=false` |
| R4 | `error_spike` | warning | `error_count_24h >= 5` (suprimida por R2) |
| R5 | `high_latency` | warning | `last_response_ms >= 5000ms` |
| R6 | `stale_sync` | warning | sistemas ativos sem sync nas últimas 24h |
| R7 | `unmatched_events` | warning | ≥1 evento sem mapeamento nas últimas 24h |
| R8 | (Recovery) | — | resolve com evidência real de execução bem-sucedida |
| **R9** | `auth_failure` (**E2.2**) | crítico | `last_http_status` == 401/403 (credencial inválida/expirada) |
| **R10** | `api_unavailable` (**E2.2**) | crítico | `last_http_status` == 0 (baseUrl não config/API fora do ar) |

### Novidades E2.2/E3.2/E3.3

- **R9 `auth_failure`**: `transferegov.adapter.ts#sync`, `sei.adapter.ts#sync` e
  `cglog.adapter.ts#sync` marcam `authError`, expondo `httpStatus: 401/403`. O
  scheduler persiste em `last_http_status`, e o alerta abre com gravidade
  **crítico** ("revise credenciais").
- **R10 `api_unavailable`**: HTTP 0 (conexão recusada / baseUrl ausente).
  Recuperado somente após `last_http_status` voltar a `200` + log de sucesso
  recente (`hasRecentSuccess`).

### Como verificar alertas em produção

```
SELECT system_id, type, severity, status, message, details->>'occurrences'
FROM integration_alerts
WHERE status IN ('open','acknowledged')
ORDER BY severity DESC, updated_at DESC;
```

---

## 4. Checklist de entrada em produção

- [ ] `.env.example` replicado no secrets manager; JWT_SECRET com 64+ chars.
- [ ] `TRANSFEREGOV_BASE_URL`, `SEI_BASE_URL` e `CGLOG_BASE_URL` apontando para os ambientes corretos.
- [ ] Testar `POST /api/integrations/webhooks/transferegov`,
      `POST /api/integrations/webhooks/sei` e `POST /api/integrations/webhooks/cglog`
      (HMAC) com hooks de teste.
- [ ] Sincronização manual: `POST /api/integrations/admin/systems/:id/sync` →
      200, `integration_logs` `success`, `http_status` 200 (Transferegov e SEI).
      CGLOG: validar via webhook (o polling permanece desabilitado até o
      contrato de consulta ser confirmado).
- [ ] Scheduler ativo com `syncEnabled=true` e intervalo <= 60 min.
- [ ] Rodar a suíte de testes: `npm test` (backend) e `npm run build`.
- [ ] Migrações idempotentes aplicadas (rodar `npx tsx src/database.ts` ou o seed
      conforme script de deploy).

---

## 5. Verificações após falhas de autenticação / API

1. **401/403 repetidos** → R9 crítico aberto. Revise:
   - Rote a chave no gestor de segredos; confira `secretEnvKey` no `config`
     (`TRANSFEREGOV_API_KEY` / `SEI_API_TOKEN` / `CGLOG_API_TOKEN`).
   - Verifique se a chave expira / precisa reautenticar (OAuth2/token).
2. **HTTP 0 repetido** → R10 crítico aberto. Verifique:
   - `baseUrl` no `config` do sistema (persistido redigido no admin).
   - Conectividade de saída (firewall/DNS) a partir do servidor do SGD.
3. **Recuperação**: o alerta SÓ fecha com evidência (último sync com
   `last_http_status=200` + `hasRecentSuccess`). Se o alerta seguir aberto,
   o recurso NÃO se recuperou de verdade.