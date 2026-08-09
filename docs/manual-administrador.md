# Manual do Administrador — SGD

Guia operacional para administradores do Sistema de Gestão de Demandas.

---

## 1. Primeiros Passos

### Acesso

1. Acesse `https://gruposgd.com.br`
2. Faça login com credenciais de administrador
3. O dashboard será exibido na tela inicial

### Credenciais Padrão (Produção)

| Usuário | Email | Senha |
|---------|-------|-------|
| Admin | `admin@sgd.gov.br` | Definida via `SEED_ADMIN_PASSWORD` |

> ⚠️ **Alterar a senha padrão imediatamente após o primeiro acesso.**

---

## 2. Gestão de Demandas

### Criar Demanda

1. Clique em "Demandas" no menu lateral
2. Clique em "Nova Demanda"
3. Preencha: título, descrição, município, UF, categoria, órgão, prioridade
4. Salve

### Editar Demanda

1. Clique na demanda na lista
2. Clique em "Editar"
3. Altere os campos desejados
4. Salve — a versão anterior é salva automaticamente

### Status da Demanda

| Status | Descrição |
|--------|-----------|
| `pendente` | Aguardando análise |
| `analise` | Em análise |
| `concluido` | Concluída |
| `rejeitado` | Rejeitada |

### Excluir / Restaurar

- Exclusão é **soft delete** (preserva dados)
- Demandas excluídas podem ser restauradas

---

## 3. Gestão de Usuários

### Criar Usuário

1. Acesse "Usuários" no menu
2. Clique em "Novo Usuário"
3. Preencha email, nome, senha, papel
4. Salve

### Papéis Disponíveis

| Papel | Permissões |
|-------|-----------|
| `admin` | Total |
| `gestor` | Demandas + Usuários + Relatórios |
| `analista` | Demandas (criar/editar) |
| `consulta` | Apenas visualização |
| `diretor` | Mesmo do gestor |
| `tecnico` | Mesmo do analista |
| `parceiro` | Visualização + Relatórios |
| `cliente` | Apenas visualização |
| `visitante` | Apenas dashboard |

### Permissões Granulares

Para permissões individuais (override do papel):
1. Acesse "Permissões" → selecione o usuário
2. Marque/desmarque permissões específicas
3. Salve

---

## 4. Integrações Governamentais

### Visualizar Status

1. Acesse "Integrações" → "Operações"
2. Visualize o status de cada sistema (Transferegov, SEI, CGLOG)
3. Verifique: status, última sincronização, latência, erros

### Sincronização Manual

1. Na aba "Operações", clique em "Sincronizar" ao lado do sistema
2. O sistema irá buscar dados最新的 do sistema externo
3. O resultado será exibido no modal

### Testar Conexão

1. Na aba "Operações", clique em "Testar Conexão"
2. Verifique se a autenticação e endpoint estão funcionando

### Configurar Sistema

1. Na aba "Sistemas", clique em "Editar" no sistema desejado
2. Atualize o config JSONB:

```json
{
  "baseUrl": "https://api.sistema.gov.br",
  "secretEnvKey": "SISTEMA_API_TOKEN",
  "authType": "token",
  "syncEnabled": true,
  "syncIntervalMinutes": 60,
  "maxRecordsPerSync": 100,
  "timeoutMs": 30000,
  "maxRetries": 3
}
```

### Monitorar Alertas

1. Na aba "Operações", visualice alertas R1–R10
2. Alertas críticos (vermelho) requerem ação imediata
3. Alertas de warning (amarelo) devem ser monitorados

---

## 5. Relatórios e Exportação

### Dashboard

O dashboard principal mostra:
- Total de demandas por status
- Demandas por município/UF
- Prioridades
- Tendências

### Exportar

1. Acesse a lista de demandas
2. Aplique os filtros desejados
3. Clique em "Exportar"
4. Escolha o formato: PDF, Excel ou CSV

### Relatórios Executivos

1. Acesse "Relatórios"
2. Selecione o tipo de relatório
3. Configure filtros
4. Gere o relatório

---

## 6. Backups

### Criar Backup

1. Acesse "Auditoria" → "Backups"
2. Clique em "Criar Backup"
3. O backup será gerado com hash SHA-256

### Verificar Integridade

1. Selecione um backup
2. Clique em "Verificar"
3. O sistema compara o hash SHA-256

### Restaurar

1. Selecione o backup desejado
2. Clique em "Restaurar"
3. Confirme a operação

> ⚠️ **Restauração sobrescreve os dados atuais.**

---

## 7. Auditoria

### Visualizar Logs

1. Acesse "Auditoria" → "Logs"
2. Filtre por: data, usuário, ação, entidade
3. Exporte se necessário

### Dashboard de Auditoria

1. Acesse "Auditoria" → "Dashboard"
2. Visualize: total de ações, ações por usuário, tendências

---

## 8. Sessões

### Visualizar Sessões Ativas

1. Acesse "Auditoria" → "Sessões"
2. Visualize: usuário, IP, navegador, data de login

### Encerrar Sessão

1. Selecione a sessão
2. Clique em "Encerrar"
3. O usuário será deslogado

---

## 9. Monitoramento

### Health Check

- `GET /api/health` — Liveness (está vivo?)
- `GET /api/health/ready` — Readiness (pronto?)
- `GET /api/monitoring/health` — Health completo

### Dashboard Operacional

1. Acesse "Integrações" → "Operações"
2. Visualize: status geral, sistemas, alertas, latência

---

## 10. Troubleshooting Comum

### Usuário não consegue logar

1. Verifique se o email está correto
2. Verifique se a conta não está bloqueada (5 tentativas)
3. Admin: resetar senha via "Usuários" → "Resetar Senha"

### Demanda não aparece

1. Verifique filtros ativos
2. Verifique se a demanda não foi excluída (soft delete)
3. Verifique a permissão do usuário

### Integração falha (R9/R10)

1. **R9 (auth):** Verificar token/API key no Render Dashboard
2. **R10 (API):** Verificar URL base no config do sistema
3. Consultar `docs/homologacao.md`

### Exportação falha

1. Verifique a quantidade de registros (limite: 10.000)
2. Verifique o formato escolhido
3. Tente exportar em lotes menores

---

## 11. Contatos

| Função | Email |
|--------|-------|
| Suporte técnico | `suporte@gruposgd.com.br` |
| Administrador | `admin@sgd.gov.br` |

---

## 12. Dicas de Segurança

1. **Senhas fortes:** ≥12 caracteres, mistura de tipos
2. **Não compartilhar** credenciais
3. **Rotacionar** chaves de integração periodicamente
4. **Monitorar** alertas R9/R10 diariamente
5. **Verificar** logs de auditoria semanalmente
6. **Manter** backups atualizados
7. **Não desativar** rate limiting
8. **Revisar** permissões de usuários periodicamente
