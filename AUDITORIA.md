# AUDITORIA COMPLETA DO PROJETO SGD Consultoria

Data: 03/08/2026
Escopo: auditoria completa (bugs, inconsistências, código morto, performance, componentes duplicados, acessibilidade, responsividade, segurança e organização). Correções automáticas aplicadas **sem alterar regras de negócio**.

---

## 1. PROBLEMAS CRÍTICOS CORRIGIDOS

### 1.1 CSRF nunca era validado no backend (SEGURANÇA — crítico)
- **Problema:** O middleware `csrfProtection` (`middleware/csrf.ts`) existia, o servidor já definia o cookie `csrf_token` no login e o frontend já enviava o header `X-CSRF-Token` em todas as requisições de escrita — porém o middleware **nunca era montado**. Como os cookies usam `SameSite=None` em produção, qualquer site malicioso poderia disparar requisições de escrita autenticadas por CSRF.
- **Correção aplicada:**
  - `server.ts`: `app.use(csrfProtection)` montado após `/api/auth` e `/api/password-reset` (fluxos que não possuem cookie csrf preexistente) e antes de todas as demais rotas.
  - `routes/auth.ts` (POST /refresh): cookie `csrf_token` é reemitido a cada renovação de token, evitando falha em sessões longas (>24h).
  - Testes (backups, audit) atualizados para enviar header + cookie (`loginAsWithCsrf` em `__tests__/helpers.ts`).
- **Validação:** 39/39 testes passando com proteção ativa.

### 1.2 Recuperação de senha sem envio de e-mail (funcionalidade incompleta)
- **Problema:** O token de reset é gerado e persistido, mas **nenhum serviço de email** (nodemailer/SMTP/SendGrid) existe no projeto; o `resetLink` construído nunca era utilizado. O fluxo de "esqueci minha senha" não funciona de ponta a ponta.
- **Correção aplicada:** removida a variável morta `resetLink` e documentado o ponto de integração no código (`password-reset.ts`) como `PENDENTE DE IMPLEMENTAÇÃO`.
- **Revisão manual:** ver item 4.1.

### 1.3 Sanitização de colunas neutrada em restauração de backup
- **Problema:** Em `backups.ts` (restore), o filtro `sanitizeColumnName(k) || true` sempre retornava `true`, anulando a sanitização (e deixando o insert lançar erro em coluna inválida).
- **Correção aplicada:** filtro que tenta validar cada coluna e **descarta colunas inválidas** em vez de lançar erro.

---

## 2. CÓDIGO MORTO REMOVIDO

| Item | Arquivo | Ação |
|---|---|---|
| `setLogLevel` (nunca chamado) | `lib/logger.ts` | Removido |
| `resetLink` (nunca utilizado) | `routes/password-reset.ts` | Removido |
| Componente `Badge` (sem consumidores) | `frontend/src/components/ui/Badge.tsx` | Deletado + export removido do barrel |
| `import()` dinâmico redundante no cleanup da blacklist | `middleware/auth.ts` | Simplificado |

> Componentes `ui/` restantes verificados para uso: `SmartSearchInput`, `SummaryCard`, `Highlight`, `FiltersDrawer`, `Drawer`, `EmptyState`, `PageHeader`, `Kpi`, `Skeleton`, `Tooltip`, `Alert`, `Modal`, `StatusBadge`, `PriorityBadge`, `Spinner`, `Card`, `Pagination` — todos consumidos.

---

## 3. MELHORIAS DE PERFORMANCE

| Rota | Antes | Depois |
|---|---|---|
| `lgpd.ts` GET `/dashboard` | 13 queries sequenciais | `Promise.all` (agrupadas) |
| `backups.ts` `exportAllData` | 11 selects em loop sequencial | `Promise.all` |
| `monitoring.ts` GET `/health` | 4 queries sequenciais | `Promise.all` |
| `demands.ts` GET `/:id` | timeline+attachments+comments sequenciais | `Promise.all` |
| `auth.ts` `cleanupBlacklist` | `DELETE FROM token_blacklist` disparado em **toda** requisição autenticada | throttled a cada 15min (SELECT de revogação mantido por correção) |

---

## 4. ITENS QUE EXIGEM REVISÃO MANUAL

1. **Envio real de e-mail de recuperação de senha** — integrar serviço SMTP/nodemailer e usar `FRONTEND_URL` para montar o link (`/reset-password?token=`). Hoje o fluxo é inutilizável de ponta a ponta.
2. **Senhas padrão no seed** (`seed.ts`) — usuários de desenvolvimento são criados com senhas hardcoded (`Admin2026!`, etc.). Para produção: definir `SEED_*_PASSWORD` nas env vars — nunca usar os padrões.
3. **CSP em produção** — `scriptSrc` só permite `'self'` + GTM. Confirmar se o frontend usa alguma biblioteca que queira `unsafe-eval`/`unsafe-inline` em produção (ex.: jwt-decode, pdf/report kits).
4. **`/api/health` e `/api/monitoring/health`** — ambos exigem `authenticateToken`; avaliar se check externo (load balancer/uptime) recebe credenciais. Se desejar health público, usar apenas `/api/health` sem auth.
5. **Acessibilidade/responsividade** — pendências pontuais levantadas na auditoria (semantic HTML, `aria-*`, contraste, alvos de toque >44px em telas pequenas) devem ser validados no browser real (não há testes E2E no projeto).

---

## 6. RECOMENDAÇÕES PARA PRODUÇÃO

- **Variáveis de ambiente obrigatórias:** `JWT_SECRET` (≥32 chars, não padrão), `DATABASE_URL`, `CORS_ORIGIN` (domínios exatos; nunca `*`), `FRONTEND_URL`. O servidor já aborta o boot se não configuradas.
- **Seu login/registro** possuem rate limiting e **bloqueio de conta** após 5 tentativas falhas (testado).
- **Backups:** criar backup via UI executa dump JSON com sha256; considere agendar backup automático (cron) e cópia off-site.
- **Monitoramento:** politagem de snapshot via endpoint `POST /api/monitoring/snapshot` (exigirá `X-CSRF-Token` — usar sessão real ou reavaliar exposição).
- **Logs de auditoria:** retenção 180d e exportação já implementadas; monitorar crescimento da tabela `audit_logs`.
- **Índices do banco:** auditar planos de consulta em tabelas grandes (`demands`, `timeline_events`, `audit_logs`, `monitoring_logs`) — candidatos a índices: `timeline_events(demand_id)`, `attachments(demand_id)`, `comments(demand_id)`, `audit_logs(created_at)`.
- **Upgrades:** alertamos que `poolOptions` do vitest foi removido no Vitest 4 (migrar para opções de topo no `vitest.config.ts`).

---

## 7. RESUMO DAS ALTERAÇÕES

- Backend: 12 arquivos alterados, CSRF ativado, 4 endpoints com queries paralelizadas, 2 bugs corrigidos, código morto removido.
- Frontend: 1 componente deletado (`Badge`), barrel atualizar.
- Testes: 39/39 passando (incluindo cobertura do novo fluxo CSRF).