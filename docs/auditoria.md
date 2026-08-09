# Auditoria e Compliance — SGD

Documento de rastreabilidade, trilha de auditoria e conformidade regulatória
do Sistema de Gestão de Demandas.

---

## 1. Visão Geral

O SGD implementa auditoria completa em todas as camadas:
- **Audit logs** — trilha de todas as ações de escrita
- **Integration logs** — histórico de operações de integração
- **Export logs** — registro de exportações de dados
- **Webhook events** — eventos brutos recebidos
- **Timeline events** — histórico legível de cada demanda
- **Demand versions** — snapshots de versões

---

## 2. Trilha de Auditoria (audit_logs)

### O que é registrado

Toda ação de escrita no sistema gera um registro em `audit_logs`:

| Campo | Descrição |
|-------|-----------|
| `entity_type` | Tipo da entidade (demand, user, integration_system) |
| `entity_id` | ID da entidade afetada |
| `action` | Tipo da ação executada |
| `user_id` | ID do usuário responsável |
| `user_name` | Nome do usuário |
| `details` | JSONB com dados da ação |
| `_ip` | IP do cliente |
| `_os` | Sistema operacional |
| `_browser` | Navegador |

### Ações Registradas

| Ação | Descrição |
|------|-----------|
| `demand.created` | Criação de demanda |
| `demand.updated` | Atualização de demanda |
| `demand.deleted` | Exclusão (soft delete) |
| `demand.restored` | Restauração |
| `integration_sync` | Sincronização via webhook |
| `integration_sync_periodic` | Sincronização periódica |
| `integration.sync.manual` | Sincronização manual |
| `integration.test-connection` | Teste de conectividade |
| `user.created` | Criação de usuário |
| `user.updated` | Atualização de usuário |
| `user.deleted` | Exclusão de usuário |
| `backup.created` | Criação de backup |
| `backup.restored` | Restauração de backup |
| `export.pdf` | Exportação PDF |
| `export.excel` | Exportação Excel |
| `export.csv` | Exportação CSV |

### Consultas Comuns

```sql
-- Últimas ações de um usuário
SELECT action, entity_type, entity_id, details, created_at
FROM audit_logs
WHERE user_id = 1
ORDER BY created_at DESC
LIMIT 50;

-- Ações em uma demanda específica
SELECT action, user_name, details, created_at
FROM audit_logs
WHERE entity_type = 'demand' AND entity_id = 'DMN-123456'
ORDER BY created_at;

-- Exportações realizadas
SELECT user_name, details->>'format' as format, created_at
FROM audit_logs
WHERE action LIKE 'export.%'
ORDER BY created_at DESC;
```

---

## 3. Auditoria de Integrações (integration_logs)

### O que é registrado

Cada operação de integração (webhook, sync manual, sync periódica, teste)
gera um registro em `integration_logs`:

| Campo | Descrição |
|-------|-----------|
| `system_code` | Sistema (transferegov, sei, cglog) |
| `direction` | `in` (webhook recebido) / `out` (sync externa) |
| `action` | Tipo da operação |
| `status` | success / warning / error |
| `duration_ms` | Duração em milissegundos |
| `http_status` | Código HTTP da resposta |
| `triggered_by` | webhook / manual / scheduler |
| `error_message` | Mensagem de erro (se houver) |

### Fluxo de Auditoria de Integração

```
CGLOG Event
      ↓
webhook_events (raw)
      ↓
integration_logs (operacional)
      ↓
demand_integrations (vínculo)
      ↓
audit_logs (rastreabilidade)
      ↓
timeline_events (histórico legível)
```

---

## 4. Timeline de Demandas (timeline_events)

Cada mudança em uma demanda gera um evento no timeline:

| Campo | Descrição |
|-------|-----------|
| `demand_id` | ID da demanda |
| `title` | Título do evento |
| `description` | Descrição detalhada |
| `user_name` | Quem realizou |
| `new_status` | Novo status (se aplicável) |
| `source` | Origem: user, integration, system |
| `metadata` | JSONB complementar |

### Exemplos

- "Demanda criada por Administrador SGD"
- "Status alterado de pendente para analise"
- "Integração Sincronizada — Sistema: TRANSFEREGOV"
- "Comentário adicionado por Analista SGD"

---

## 5. Export Logs

Toda exportação de dados (PDF, Excel, CSV) é registrada:

| Campo | Descrição |
|-------|-----------|
| `user_id` | Quem exportou |
| `format` | pdf / excel / csv |
| `record_count` | Quantidade de registros |
| `created_at` | Data/hora |

---

## 6. Versões de Demandas (demand_versions)

Snapshots completos de demandas保存as versões:

| Campo | Descrição |
|-------|-----------|
| `demand_id` | ID da demanda |
| `version` | Número da versão |
| `data` | JSONB com snapshot completo |
| `created_at` | Data/hora da versão |

---

## 7. Conformidade LGPD

### Princípios Implementados

1. **Minimização de dados** — coleta apenas dados necessários
2. **Finalidade** — dados usados apenas para gestão de demandas
3. **Controle** — usuários podem visualizar seus dados
4. **Segurança** — criptografia, RBAC, auditoria
5. **Transparência** — logs de exportação rastreáveis

### Dados Pessoais Identificados

| Dado | Localização | Finalidade |
|------|------------|------------|
| Email | users | Login e identificação |
| Nome | users | Exibição e auditoria |
| IP | audit_logs, active_sessions | Segurança e rastreabilidade |
| User-Agent | active_sessions | Segurança |

### Controles

- **Soft delete** — dados nunca são fisicamente removidos
- **Auditoria** — toda ação de escrita é registrada
- **RBAC** — acesso restrito por permissão
- **Rate limiting** — prevenção contra abuso
- **Backup** — snapshots com SHA-256 para integridade

### Dashboard LGPD

`GET /api/lgpd/dashboard` — visão de conformidade:
- Total de dados pessoais
- Últimas exportações
- Sessões ativas
- Logs de acesso

---

## 8. Princípio do Menor Privilégio

### Em Todas as Camadas

| Camada | Controle |
|--------|----------|
| API Routes | `requirePermission(key)` — 403 sem permissão |
| Integrações | `sanitizeIntegrationConfig()` — redige segredos |
| Frontend | Botões/links visíveis apenas com permissão |
| Backup | `backups.create` / `backups.restore` restrito |
| Sessões | `sessions.terminate` — admin only |
| Senhas | `password_history` — previne reuso |

### Bypass

- `admin` / `administrador` bypass de `requirePermission`
- Nenhum bypass para: JWT validation, CSRF, rate limiting, HMAC webhooks

---

## 9. Rastreabilidade de Integrações

### Fluxo Completo

```
1. Sistema externo envia webhook
   → webhook_events (payload bruto, IP, timestamp)

2. Backend valida HMAC
   → webhook_events.signature verificada

3. Backend processa
   → integration_logs (ação, status, duração)

4. Demanda é atualizada
   → demands (status/prazo alterados)
   → timeline_events (evento registrado)
   → audit_logs (ação documentada)
   → demand_integrations (vínculo atualizado)

5. Evento publicado
   → Event Bus → SSE → Frontend (tempo real)
```

### Consulta de Rastreabilidade

```sql
-- Traçar evento completo: webhook → demanda
SELECT we.id as webhook_id, we.payload, we.status,
       il.action, il.status, il.duration_ms,
       di.external_id, di.proposal_number,
       al.action as audit_action, al.details
FROM webhook_events we
JOIN integration_logs il ON il.webhook_event_id = we.id
LEFT JOIN demand_integrations di ON di.demand_id = il.demand_id
LEFT JOIN audit_logs al ON al.entity_id = il.demand_id
WHERE we.id = 123;
```

---

## 10. Retenção de Dados

| Dados | Retenção | Justificativa |
|-------|----------|---------------|
| audit_logs | 180 dias | Conformidade e rastreabilidade |
| monitoring_logs | 30 dias | Operacional |
| export_logs | 90 dias | LGPD — rastreabilidade |
| integration_alerts (resolvidos) | 90 dias | Histórico |
| active_sessions (inativas) | 24 horas | Segurança |
| login_attempts | 48 horas | Segurança |
| token_blacklist | Até expirar | Segurança |
| webhook_events | Permanente | Fonte de verdade |
| demand_versions | Permanente | Histórico |
