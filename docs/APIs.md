# APIs — SGD

Documentação dos endpoints da API REST do Sistema de Gestão de Demandas.

**Base URL:** `/api` | **Autenticação:** JWT (Cookie) | **CSRF:** Header `X-CSRF-Token`

---

## 1. Autenticação

### POST `/api/auth/login`

Autenticar e obter tokens.

**Request:**
```json
{
  "email": "admin@sgd.gov.br",
  "password": "senha"
}
```

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "email": "admin@sgd.gov.br",
    "name": "Administrador SGD",
    "role": "admin",
    "permissions": ["demands.view", "..."]
  }
}
```

**Cookies setados:** `token` (HTTP-only), `refresh_token` (HTTP-only), `csrf_token`

---

### POST `/api/auth/refresh`

Renovar access token using refresh token.

---

### POST `/api/auth/logout`

Encerrar sessão, blacklist token.

---

### GET `/api/auth/me`

Obter perfil do usuário autenticado.

---

### POST `/api/auth/register`

Registrar novo usuário. **Permissão:** admin only.

---

### PUT `/api/auth/change-password`

Alterar senha do usuário autenticado.

---

## 2. Usuários

### GET `/api/auth/users`

Listar todos os usuários. **Permissão:** `users.view`

**Query params:** `page`, `limit`, `search`, `role`, `active`

---

### GET `/api/auth/users/active`

Listar usuários ativos (formato compacto).

---

### POST `/api/auth/users`

Criar usuário. **Permissão:** admin/gestor.

**Request:**
```json
{
  "email": "novo@sgd.gov.br",
  "password": "senha",
  "name": "Novo Usuário",
  "role": "analista"
}
```

---

### PUT `/api/auth/users/:id`

Atualizar usuário. **Permissão:** admin only.

---

### DELETE `/api/auth/users/:id`

Soft-delete usuário.

---

### PUT `/api/auth/users/:id/password`

Admin resetar senha de usuário.

---

## 3. Demandas

### GET `/api/demands`

Listar demandas com filtros e paginação. **Permissão:** `demands.view`

**Query params:**
| Param | Tipo | Descrição |
|-------|------|-----------|
| `page` | number | Página (default: 1) |
| `limit` | number | Itens por página (default: 20) |
| `search` | string | Busca por título/descrição |
| `status` | string | Filtrar por status |
| `priority` | string | Filtrar por prioridade |
| `municipality` | string | Filtrar por município |
| `uf` | string | Filtrar por UF |
| `organ` | string | Filtrar por órgão |
| `category` | string | Filtrar por categoria |
| `sortBy` | string | Campo de ordenação |
| `sortOrder` | string | asc/desc |

**Response (200):**
```json
{
  "demands": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

### GET `/api/demands/:id`

Obter demanda específica com timeline e anexos.

---

### POST `/api/demands`

Criar nova demanda. **Permissão:** `demands.create`

**Request:**
```json
{
  "title": "Construção de escola",
  "description": "Detalhes...",
  "category": "EDUCAÇÃO",
  "municipality": "SOBRAL",
  "uf": "CE",
  "priority": "alta",
  "organ": "MEC/FNDE"
}
```

---

### PUT `/api/demands/:id`

Atualizar demanda. **Permissão:** `demands.edit`

---

### DELETE `/api/demands/:id`

Soft-delete demanda. **Permissão:** `demands.delete`

---

### POST `/api/demands/:id/restore`

Restaurar demanda excluída.

---

### POST `/api/demands/:id/timeline`

Adicionar evento ao timeline.

---

### GET `/api/demands/:id/versions`

Histórico de versões da demanda.

---

### GET `/api/demands/stats/dashboard`

Estatísticas do dashboard.

---

### GET `/api/demands/stats/executive`

Estatísticas executivas filtradas.

---

### GET `/api/demands/calendar/events`

Eventos de calendário derivados de demandas.

---

## 4. Comentários

### GET `/api/demands/:id/comments`

Listar comentários da demanda.

---

### POST `/api/demands/:id/comments`

Adicionar comentário. **Permissão:** `demands.edit`

---

## 5. Municípios

### GET `/api/municipalities`

Listar municípios. **Permissão:** `demands.view`

---

### GET `/api/municipalities/:id`

Obter município com suas demandas.

---

### POST `/api/municipalities`

Criar município (validação IBGE). **Permissão:** `demands.create`

---

### PUT `/api/municipalities/:id`

Atualizar município.

---

### DELETE `/api/municipalities/:id`

Soft-delete município.

---

### POST `/api/municipalities/:id/restore`

Restaurar município excluído.

---

### GET `/api/municipalities/stats/by-region`

Estatísticas agrupadas por região.

---

## 6. Órgãos

### GET `/api/organs`

Listar todos os órgãos.

---

### POST `/api/organs`

Criar órgão. **Permissão:** admin only.

---

### PUT `/api/organs/:id`

Renomear órgão.

---

### DELETE `/api/organs/:id`

Desativar órgão.

---

## 7. Padronização

### GET `/api/standardization/municipalities`

Autocomplete de municípios (via IBGE).

---

### GET `/api/standardization/objects`

Autocomplete de títulos de demandas.

---

### POST `/api/standardization/scan`

Gerar relatório de inconsistências.

---

### POST `/api/standardization/apply`

Aplicar correções de padronização.

---

## 8. Configurações

### GET `/api/settings`

Obter configurações do sistema.

---

### PUT `/api/settings`

Atualizar configurações. **Permissão:** admin.

---

### GET `/api/settings/export`

Exportar todos os dados como JSON.

---

### POST `/api/settings/import`

Importar dados de backup JSON.

---

## 9. Auditoria

### GET `/api/audit`

Listar logs de auditoria (paginado, filtrável). **Permissão:** `audit.view`

**Query params:** `page`, `limit`, `entity_type`, `action`, `user_id`, `from`, `to`

---

### GET `/api/audit/dashboard-stats`

Estatísticas do dashboard de auditoria.

---

### POST `/api/audit/log-export`

Registrar ação de exportação.

---

### GET `/api/audit/stats`

Contagem total de logs.

---

## 10. Integrações — Sistemas

### GET `/api/integrations`

Documentação da API de integrações.

---

### GET `/api/integrations/systems`

Listar sistemas de integração. **Permissão:** `integrations.view`

---

### GET `/api/integrations/systems/:id`

Detalhar sistema (config redigida). **Permissão:** `integrations.view`

---

### POST `/api/integrations/systems`

Criar sistema. **Permissão:** `integrations.manage` + CSRF

---

### PUT `/api/integrations/systems/:id`

Atualizar sistema. **Permissão:** `integrations.manage` + CSRF

**Body:** `{ name, description, config }` — `code` e `secret_env_key` são imutáveis.

---

### PATCH `/api/integrations/systems/:id/activate`

Ativar sistema. **Permissão:** `integrations.manage` + CSRF

---

### PATCH `/api/integrations/systems/:id/deactivate`

Desativar sistema. **Permissão:** `integrations.manage` + CSRF

---

## 11. Integrações — Administração

### GET `/api/integrations/admin/dashboard`

Dashboard consolidado. **Permissão:** `integrations.view`

---

### GET `/api/integrations/admin/health`

Saúde individual por sistema.

---

### GET `/api/integrations/admin/logs`

Histórico paginado/filtrado.

**Query params:** `page`, `limit`, `systemId`, `status`, `direction`, `from`, `to`, `hasError`, `search`

---

### GET `/api/integrations/admin/systems/:id`

Detalhes do sistema para admin.

---

### GET `/api/integrations/admin/adapters`

Lista de adapters registrados.

---

### GET `/api/integrations/admin/sync-status`

Status de sincronização de todos os sistemas.

---

### GET `/api/integrations/admin/overview`

Overview operacional (Fase E3.1).

---

### POST `/api/integrations/admin/systems/:id/test-connection`

Testar conectividade. **Permissão:** `integrations.admin` + CSRF

---

### POST `/api/integrations/admin/systems/:id/sync`

Sincronização manual. **Permissão:** `integrations.sync` + CSRF

---

## 12. Webhooks (Entrada)

### POST `/api/integrations/webhooks/:system`

Receber webhook autenticado via HMAC-SHA256.

**Headers obrigatórios:**
| Header | Descrição |
|--------|-----------|
| `X-Signature` | HMAC-SHA256 de `timestamp\n[key]\nbody` |
| `X-Timestamp` | Timestamp ISO |
| `X-Idempotency-Key` | Chave de idempotência |

**Body:** JSON bruto do evento (parsed pelo backend)

**Autenticação:** HMAC (excluído de JWT/CSRF)

---

## 13. Webhooks Outbound

### GET `/api/admin/outbound-webhooks`

Listar webhooks configurados.

---

### POST `/api/admin/outbound-webhooks`

Criar webhook outbound.

---

### PUT `/api/admin/outbound-webhooks/:id`

Atualizar webhook.

---

### DELETE `/api/admin/outbound-webhooks/:id`

Excluir webhook.

---

### POST `/api/admin/outbound-webhooks/:id/test`

Enviar evento de teste.

---

### GET `/api/admin/outbound-webhooks/deliveries`

Histórico de entregas.

---

### POST `/api/admin/outbound-webhooks/deliveries/:id/retry`

Reentregar falha.

---

## 14. Permissões

### GET `/api/permissions`

Listar todas as permissões (agrupadas).

---

### GET `/api/permissions/my`

Obter permissões do usuário atual.

---

### GET `/api/permissions/user/:id`

Obter permissões de um usuário.

---

### PUT `/api/permissions/user/:id`

Atualizar permissões do usuário.

---

## 15. Sessões

### GET `/api/sessions`

Listar sessões ativas. **Permissão:** admin.

---

### DELETE `/api/sessions/:id`

Encerrar sessão.

---

### GET `/api/sessions/my-sessions`

Listar próprias sessões.

---

## 16. Senha

### POST `/api/password-reset/request`

Solicitar token de redefinição.

---

### POST `/api/password-reset/reset`

Redefinir senha com token.

---

## 17. Backups

### GET `/api/backups`

Listar backups.

---

### POST `/api/backups`

Criar novo backup. **Permissão:** `backups.create`

---

### GET `/api/backups/:id/download`

Download do backup.

---

### POST `/api/backups/:id/verify`

Verificar integridade (SHA-256).

---

### POST `/api/backups/:id/restore`

Restaurar backup.

---

## 18. Monitoramento

### GET `/api/health`

Liveness probe (sem auth). Retorna `200 OK`.

---

### GET `/api/health/ready`

Readiness probe. Verifica conectividade com banco.

---

### GET `/api/monitoring/health`

Health check completo (server, DB, app).

---

### POST `/api/monitoring/snapshot`

Gravar snapshot de métricas.

---

### GET `/api/monitoring/history`

Histórico de monitoramento.

---

### GET `/api/monitoring/system-health`

Dashboard operacional de saúde (D2.3).

---

## 19. LGPD

### GET `/api/lgpd/dashboard`

Dashboard de conformidade LGPD.

---

## 20. Upload

### POST `/api/demands/:id/attachments`

Upload de arquivos (multipart/form-data).

---

### GET `/api/attachments/:id`

Download de anexo.

---

### DELETE `/api/attachments/:id`

Excluir anexo (soft delete).

---

## 21. Server-Sent Events

### GET `/api/events/integrations`

Stream de eventos em tempo real.

**Headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`

**Eventos:** `integration:synced`, `demand:status_changed`, `health:updated`

---

## 22. Padrões de Resposta

### Sucesso

```json
{ "..." : "dados" }
```

### Erro

```json
{
  "error": "Mensagem de erro descritiva"
}
```

### Paginação

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## 23. Códigos de Status

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 201 | Criado |
| 400 | Requisição inválida |
| 401 | Não autenticado |
| 403 | Sem permissão |
| 404 | Não encontrado |
| 409 | Conflito |
| 429 | Rate limit excedido |
| 500 | Erro interno |
