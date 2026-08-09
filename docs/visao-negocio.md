# Visão de Negócio — SGD

Documento executivo para gestores, diretores e órgãos parceiros.

**Linguagem:** acessível, sem jargão técnico excessivo
**Foco:** problemas resolvidos, benefícios, eficiência, governança

---

## 1. O Que é o SGD

O **Sistema de Gestão de Demandas (SGD)** é uma plataforma digital para
gerenciar demandas de órgãos públicos municipais — da criação à resolução,
com acompanhamento em tempo real, integração com sistemas do governo federal
e auditoria completa.

**Em palavras simples:**
> Um "painel de controle" que centraliza todas as demandas do órgão,
> mostra o que está pendente, o que foi resolvido, e conecta
> automaticamente com sistemas como Transferegov, SEI e CGLOG.

---

## 2. O Problema que Resolve

### Situação Atual (Sem SGD)

| Problema | Impacto |
|----------|---------|
| Demandas em planilhas e e-mails | Perda de informações, duplicação |
| Sem acompanhamento em tempo real | Prazos perdidos, surpresas |
| Dados em sistemas isolados | Inconsistência, retrabalho |
| Sem trilha de auditoria | Dificuldade em prestar contas |
| Relatórios manuais | Demora, erros, falta de indicadores |
| Comunicação entre órgãos | Atrasos, mal-entendidos |

### Com o SGD

| Solução | Benefício |
|---------|-----------|
| Painel centralizado | Visão completa de todas as demandas |
| Acompanhamento em tempo real | Alertas automáticos, sem surpresas |
| Integração com sistemas federais | Dados consistentes, sem digitação duplicada |
| Auditoria completa | Transparência, conformidade com LGPD |
| Relatórios automáticos | Decisões baseadas em dados |
| Comunicação integrada | Colaboração eficiente |

---

## 3. Benefícios para Gestores

### Visão Instantânea

- **Dashboard** com indicadores: total de demandas, por status, por município
- **Alertas** quando algo precisa de atenção
- **Filtros** por região, prioridade, órgão, período

### Controle Total

- **Quem** criou, alterou, resolveu cada demanda
- **Quando** cada ação foi realizada
- **O que** mudou em cada atualização
- **Por quê** (via comentários e timeline)

### Eficiência Operacional

- **Eliminação de planilhas** — tudo em um sistema
- **Sincronização automática** — dados atualizados sem esforço manual
- **Processos padronizados** — mesma forma de trabalhar para todos

### Conformidade

- **LGPD** — dados protegidos e rastreáveis
- **Auditoria** — trilha completa para órgãos de controle
- **Backups** — dados protegidos com verificação de integridade

---

## 4. Benefícios para a Direção

### Indicadores para Decisão

| Indicador | O que mostra |
|-----------|-------------|
| Total de demandas | Volume de trabalho |
| Demandas por status | Eficiência do processo |
| Tempo médio de resolução | Produtividade |
| Demandas por município | Distribuição geográfica |
| Órgãos mais demandados | Foco de recursos |
| Tendências | Evolução ao longo do tempo |

### Transparência

- Relatórios em PDF, Excel e CSV
- Dashboards atualizados em tempo real
- Dados disponíveis para consulta

### Governança

- **Papéis e permissões** — cada vê apenas o que pode
- **Auditoria** — toda ação é registrada
- **Backup** — dados protegidos

---

## 5. Integrações Governamentais

### O Que São

O SGD se conecta automaticamente com sistemas do governo federal:

| Sistema | O que faz |
|---------|----------|
| **Transferegov** | Acompanha propostas de transferências voluntárias |
| **SEI** | Consulta processos eletrônicos de informação |
| **CGLOG** | Registra logs de acesso e rastreamento |

### Como Funciona (Sem Jargão)

1. O sistema externo envia uma atualização (ex: "proposta aprovada")
2. O SGD recebe, entende e atualiza a demanda correspondente
3. O gestor vê a mudança automaticamente no painel
4. Tudo é registrado para auditoria

### Benefício

- **Sem digitação duplicada** — dados chegam automaticamente
- **Dados consistentes** — mesmo status no SGD e no sistema externo
- **Rastreabilidade** — sabe quando e de onde veio cada informação

---

## 6. Segurança

### Como Protegemos os Dados

| Controle | O que faz |
|----------|----------|
| **Login seguro** | Senhas criptografadas, bloqueio após tentativas |
| **Controle de acesso** | Cada usuário vê apenas o que pode |
| **Proteção de transporte** | Dados criptografados em trânsito (HTTPS) |
| **Auditoria** | Toda ação é registrada com data, hora e responsável |
| **Backups** | Dados protegidos e verificáveis |
| **Conformidade LGPD** | Dados pessoais protegidos conforme lei |

### Para Órgãos de Controle

- Trilha completa de todas as ações
- Logs de exportação (quem exportou, quando, quantos registros)
- Verificação de integridade de backups (SHA-256)
- Retenção configurável de dados

---

## 7. Escalabilidade

### Hoje

- 3 sistemas governamentais integrados
- 10 municípios cadastrados
- 30 tabelas de dados
- 626+ testes automatizados

### Amanhã

- **Novos sistemas:** PNCP, Comprasnet, qualquer API governamental
- **Novos órgãos:** arquitetura multi-tenant pronta
- **Novos relatórios:** dashboards customizáveis
- **Novos fluxos:** extensível por adapters

---

## 8. Infraestrutura

### Onde Roda

| Componente | Onde | O que faz |
|-----------|------|-----------|
| Frontend | Vercel | Interface do usuário (React) |
| Backend | Render.com | API e lógica de negócio |
| Banco | PostgreSQL | Dados (30 tabelas) |
| Domínio | gruposgd.com.br | Acesso via navegador |

### Vantagens

- **Sem servidor físico** — infraestrutura gerenciada
- **Escalável** — cresce com a demanda
- **Backup automático** — dados protegidos
- **SSL/HTTPS** — segurança de transporte

---

## 9. Números que Importam

| Métrica | Valor |
|---------|-------|
| Tabelas de dados | 30 |
| Endpoints de API | 60+ |
| Testes automatizados | 626+ |
| Regras de alerta | 10 (R1–R10) |
| Papéis de acesso | 10 |
| Permissões granulares | 30+ |
| Sistemas integrados | 3 (Transferegov, SEI, CGLOG) |
| Retenção de auditoria | 180 dias |
| Documentação técnica | 11 documentos |

---

## 10. Próximos Passos

### Curto Prazo (1-3 meses)

- Dashboard executivo avançado
- Métricas de performance (Prometheus/Grafana)
- Integração com e-mails e notificações

### Médio Prazo (3-6 meses)

- Novas integrações (PNCP, Comprasnet)
- Relatórios customizados
- Exportação avançada

### Longo Prazo (6-12 meses)

- Multi-órgão (multi-tenant completo)
- Inteligência artificial para triagem
- Integração com sistemas de contratos

---

## 11. Contato

| Função | Responsável |
|--------|------------|
| Produto | [Nome] |
| Desenvolvimento | [Nome] |
| Operações | [Nome] |

**Email:** [contato@orgao.gov.br]
**Telefone:** [XX XXXX-XXXX]

---

## 12. Resumo Executivo (1 Página)

### SGD — Sistema de Gestão de Demandas

**Problema:** Demandas descentralizadas, sem rastreabilidade, sem integração.

**Solução:** Plataforma centralizada com gestão, acompanhamento em tempo real,
integrações governamentais e auditoria completa.

**Benefícios:**
- Eliminação de planilhas manuais
- Acompanhamento em tempo real
- Integração com Transferegov, SEI e CGLOG
- Auditoria completa para órgãos de controle
- Indicadores para tomada de decisão
- Conformidade com LGPD

**Tecnologia:** React, Express, PostgreSQL — infraestrutura gerenciada (Vercel + Render).

**Status:** Em operação, documentado, 626+ testes automatizados.

**Próximo passo:** Expansão para novos sistemas e órgãos.
