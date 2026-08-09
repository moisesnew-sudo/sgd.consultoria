# SGD — Apresentação Executiva Institucional

**Sistema de Gestão de Demandas**
*Plataforma inteligente de gestão, integração e monitoramento governamental*

---

## Slide 1 — Capa

### SGD — Sistema de Gestão de Demandas

**Plataforma inteligente de gestão, integração e monitoramento governamental**

- Órgão: [Nome do Órgão]
- Data: Agosto 2026
- Versão: 2.0

---

## Slide 2 — O Problema

### Desafios da Gestão Governamental

**Processos Descentralizados**
- Demandas espalhadas em planilhas, e-mails e sistemas legados
- Sem visão consolidada do fluxo de trabalho

**Dificuldade de Acompanhamento**
- Status difícil de verificar em tempo real
- Prazos perdidos por falta de alertas

**Ausência de Rastreabilidade**
- Quem alterou? Quando? Por quê?
- Sem trilha de auditoria confiável

**Comunicação entre Sistemas**
- Transferegov, SEI e CGLOG operando isoladamente
- Dados duplicados, inconsistências

**Necessidade de Transparência**
- Gestores sem indicadores para tomada de decisão
- Relatórios manuais e demorados

---

## Slide 3 — A Solução SGD

### Uma Plataforma, Todos os Problemas Resolvidos

**Gestão Centralizada**
- Demandas, municípios, órgãos e responsáveis em um só lugar
- Fluxo de trabalho padronizado

**Acompanhamento em Tempo Real**
- Dashboard executivo com indicadores
- Notificações instantâneas via SSE

**Integrações Externas**
- Transferegov, SEI e CGLOG conectados automaticamente
- Sincronização periódica e webhooks

**Auditoria Completa**
- Trilha de todas as ações
- Logs de exportação e integração

**Indicadores para Decisão**
- Estatísticas por município, região, prioridade
- Relatórios em PDF, Excel e CSV

---

## Slide 4 — Arquitetura da Plataforma

### Componentes do SGD

```
┌─────────────────────────────────────────────┐
│            FRONTEND (React)                  │
│   Dashboard • Demandas • Relatórios          │
│   Integrações • Auditoria • Configurações    │
└──────────────────┬──────────────────────────┘
                   │ HTTPS + JWT
┌──────────────────▼──────────────────────────┐
│           BACKEND (Express API)              │
│   Autenticação • RBAC • CSRF • Rate Limit    │
│   Rotas • Processadores • Adapters           │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│          PostgreSQL (Banco de Dados)          │
│   30 tabelas • Multi-tenant • Índices        │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│       CAMADA DE INTEGRAÇÕES                  │
│   Adapters • Scheduler • Processor           │
│   Event Bus • SSE • Alert Engine             │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│     SISTEMAS GOVERNAMENTAIS                  │
│   Transferegov • SEI • CGLOG                 │
└─────────────────────────────────────────────┘
```

**Stack:** React 19 • Express • PostgreSQL 16 • TypeScript
**Deploy:** Vercel (frontend) • Render.com (backend)

---

## Slide 5 — Gestão de Demandas

### Ciclo de Vida Completo

**Criação**
- Formulário com validação (município IBGE, órgão, prioridade)
- Validação automática de dados

**Acompanhamento**
- Status: Pendente → Análise → Concluído/Rejeitado
- Timeline com histórico completo

**Colaboração**
- Comentários por demanda
- Notificações em tempo real

**Histórico**
- Versões anteriores preservadas
- Exclusão segura (soft delete)
- Restauração quando necessário

**Integração**
- Número de proposta vinculado a sistemas externos
- Status sincronizado automaticamente

---

## Slide 6 — Tempo Real

### Event Bus + Server-Sent Events

**Como funciona:**

```
Ação no SGD → Event Bus → PostgreSQL NOTIFY → SSE → Frontend
```

**Benefícios:**
- Atualização automática sem F5
- Múltiplas abas sincronizadas
- Notificações de integração em tempo real
- Baixa latência (< 100ms)

**Eventos monitorados:**
- Demanda criada/atualizada
- Status alterado
- Integração sincronizada
- Alerta disparado

---

## Slide 7 — Integrações Governamentais

### Três Sistemas, Uma Arquitetura

**Transferegov**
- Transferências voluntárias
- Consulta de propostas e convênios
- Status: APROVADO, EM_ANÁLISE, PENDENTE, CANCELADO

**SEI**
- Processos Eletrônicos de Informação
- Consulta por NUP (Número Único de Protocolo)
- Status: TRAMITANDO, FINALIZADO

**CGLOG**
- Logs de Acesso e Rastreamento
- Consulta por protocolo ou proposta
- Status: EM_ANÁLISE, CONCLUÍDO, CANCELADO

**Fluxo Unificado:**

```
Sistema Externo → Webhook (HMAC) → Adapter → Processor → SGD
                                          ↕
                                   Scheduler (pull periódico)
```

**Arquitetura extensível:** novos sistemas integram implementando uma interface.

---

## Slide 8 — Segurança

### Controles em Todas as Camadas

**Autenticação**
- JWT (access 15min + refresh 7 dias)
- Senhas bcrypt (salt rounds: 10)
- Bloqueio após 5 tentativas

**Autorização (RBAC)**
- 10 papéis: admin, gestor, analista, consulta...
- 30+ permissões granulares
- Princípio do menor privilégio

**Proteção de Transporte**
- HTTPS obrigatório (produção)
- CSRF token em requisições de escrita
- Helmet (HSTS, CSP, X-Frame-Options)

**Webhooks**
- HMAC-SHA256 com timestamp
- Anti-replay (5 minutos)
- Idempotência

**Auditoria**
- Trilha completa de todas as ações
- IP, navegador, sistema operacional
- Retenção configurável (180 dias)

**Conformidade**
- LGPD: minimização, finalidade, controle
- Secrets nunca persistidos no banco
- Redação automática de credenciais

---

## Slide 9 — Observabilidade

### Saúde do Sistema em Tempo Real

**Health Dashboard**
- Status de cada componente (API, DB, Event Bus, Scheduler)
- Latência de resposta
- Conexões ativas

**Métricas**
- CPU e memória do servidor
- Erros nas últimas 24h
- Latência de integrações
- Demandas processadas

**Alertas Inteligentes (R1–R10)**

| Regra | Tipo | Severidade |
|-------|------|-----------|
| R1 | Falhas consecutivas | Crítico |
| R2 | HTTP 5xx recorrente | Crítico |
| R3 | Sistema inativo | Crítico |
| R5 | Latência elevada | Warning |
| R6 | Sync desatualizado | Warning |
| R9 | Falha de autenticação | Crítico |
| R10 | API indisponível | Crítico |

**Recuperação automática** com evidência real (R8).

---

## Slide 10 — Benefícios

### Impacto nos Resultados

**Redução Operacional**
- Eliminação de planilhas manuais
- Sincronização automática com sistemas externos
- Processos padronizados

**Rastreabilidade**
- Trilha completa de todas as ações
- Quem, quando, onde, por quê
- Conformidade com LGPD

**Transparência**
- Dashboards para gestores
- Indicadores em tempo real
- Relatórios automaticamente gerados

**Integração**
- Transferegov, SEI e CGLOG conectados
- Dados consistentes entre sistemas
- Eliminação de digitação duplicada

**Tomada de Decisão**
- Estatísticas por município, região, prioridade
- Tendências e comparativos
- Alertas proativos

---

## Slide 11 — Escalabilidade

### Arquitetura Pronta para Crescer

**Modular**
- Novos sistemas integram implementando uma interface
- Scheduler compartilhado
- Processor centralizado

**Extensível**
- Novos adapters (PNCP, Comprasnet, etc.)
- Novos status mapeáveis
- Novos alertas configuráveis

**Multi-tenant**
- Coluna `tenant_id` em todas as tabelas
- Isolamento de dados por órgão
- Pronto para expansão

**Multi-instância**
- pg_advisory_lock para execução única
- PostgreSQL LISTEN/NOTIFY para SSE
- Stateless (tokens em cookies)

---

## Slide 12 — Roadmap

### Evolução do SGD

**Concluído**
- ✅ Gestão de demandas completa
- ✅ Autenticação e RBAC
- ✅ Alertas e tempo real (D1)
- ✅ Observabilidade (D2)
- ✅ Webhooks externos (D3)
- ✅ Integrações governamentais (E1–E3)
- ✅ Documentação técnica (F1.1)

**Próximos Passos**
- 🔄 Dashboard executivo avançado
- 🔄 Métricas Prometheus/Grafana
- 🔄 Dead-letter queue para reprocessamento
- 🔄 OpenTelemetry (tracing distribuído)
- 🔄 Novas integrações (PNCP, Comprasnet)
- 🔄 Exportação avançada (relatórios customizados)
- 🔄 Integração com e-mails e notificações push

**Visão**
Transformar o SGD na plataforma referência de gestão governamental digital do Brasil.
