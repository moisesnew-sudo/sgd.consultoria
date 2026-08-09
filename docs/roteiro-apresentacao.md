# Roteiro de Apresentação — SGD

Guia do apresentador para a apresentação institucional do Sistema de Gestão de Demandas.

**Duração total estimada:** 25 minutos
**Público:** gestores, direção, SERPRO, órgãos parceiros, equipes técnicas

---

## Pré-Requisitos

- Projetor ou tela compartilhada
- Acesso ao SGD funcional (demo ao vivo, se possível)
- Cópia desta impressa (para referência)

---

## Slide 1 — Capa (0:00 – 0:30)

**Objetivo:** Apresentar o nome, propósito e contexto.

**Mensagem principal:**
> "Apresentamos o SGD — Sistema de Gestão de Demandas — uma plataforma inteligente de gestão, integração e monitoramento governamental."

**Nota do apresentador:**
Apresente-se, o órgão, e o motivo da apresentação. Mencione que o sistema está em operação e documentado.

---

## Slide 2 — O Problema (0:30 – 3:00)

**Objetivo:** Criar urgência e identificação com os problemas.

**Mensagem principal:**
> "Órgãos governamentais enfrentam demandas descentralizadas, sem rastreabilidade e sem integração entre sistemas."

**Explicação do apresentador:**
Descreva 2-3 situações reais que o público conhece:
- "Quantas vezes perdemos o prazo de uma demanda porque ninguém sabia o status?"
- "Dados duplicados entre planilhas, e-mails e sistemas legados"
- "Gestores sem indicadores para tomada de decisão"
- "Auditoria impossível sem trilha de ações"

**Duração:** 2,5 minutos

---

## Slide 3 — A Solução SGD (3:00 – 5:30)

**Objetivo:** Apresentar a visão geral da solução.

**Mensagem principal:**
> "O SGD centraliza gestão, acompanhamento, integração e auditoria em uma única plataforma."

**Explicação do apresentador:**
Destaque os 5 pilares:
1. **Gestão centralizada** — tudo em um lugar
2. **Tempo real** — atualizações instantâneas
3. **Integrações** — Transferegov, SEI, CGLOG conectados
4. **Auditoria** — trilha completa
5. **Indicadores** — dados para decisão

**Duração:** 2,5 minutos

---

## Slide 4 — Arquitetura (5:30 – 8:00)

**Objetivo:** Mostrar a solidez técnica (sem excesso de detalhes).

**Mensagem principal:**
> "Arquitetura em camadas: frontend moderno, backend robusto, banco seguro e integrações padronizadas."

**Explicação do apresentador:**
Percorra os componentes de cima para baixo:
- **Frontend:** React, Tailwind — interface moderna e responsiva
- **Backend:** Express, TypeScript — API REST segura
- **Banco:** PostgreSQL — 30 tabelas, backup automático
- **Integrações:** Adapters, Scheduler, Event Bus — arquitetura extensível
- **Deploy:** Vercel + Render — infraestrutura gerenciada

Se houver demo ao vivo, mostre o dashboard此时.

**Duração:** 2,5 minutos

---

## Slide 5 — Gestão de Demandas (8:00 – 10:30)

**Objetivo:** Mostrar o core do sistema.

**Mensagem principal:**
> "Ciclo de vida completo: criação, acompanhamento, colaboração, histórico e integração."

**Explicação do apresentador:**
- Mostre a tela de demandas (se demo disponível)
- Destaque: formulário com validação, status, timeline, comentários
- Mencione: exclusão segura, restauração, versões anteriores
- Conecte com o problema: "Antes, isso era feito em planilhas. Agora, é automático e rastreável."

**Duração:** 2,5 minutos

---

## Slide 6 — Tempo Real (10:30 – 12:00)

**Objetivo:** Mostrar diferencial tecnológico.

**Mensagem principal:**
> "Atualizações instantâneas: quando algo muda no sistema, todos veem ao mesmo tempo."

**Explicação do apresentador:**
- Explique o fluxo: ação → Event Bus → PostgreSQL → SSE → tela
- Destaque: múltiplas abas sincronizadas, baixa latência
- Use analogia: "Como um WhatsApp do sistema — quando alguém fala, todos recebem"

**Duração:** 1,5 minutos

---

## Slide 7 — Integrações (12:00 – 15:30)

**Objetivo:** Mostrar o diferencial competitivo.

**Mensagem principal:**
> "Três sistemas governamentais conectados automaticamente, com a mesma arquitetura."

**Explicação do apresentador:**
- **Transferegov:** "Consulta propostas de transferências voluntárias automaticamente"
- **SEI:** "Acompanha processos eletrônicos por NUP"
- **CGLOG:** "Registra logs de acesso e rastreamento"

Explique o fluxo simples:
1. Sistema externo envia dado
2. SGD recebe, normaliza, processa
3. Demanda é atualizada automaticamente
4. Timeline e auditoria são registrados

Destaque: "Novos sistemas integram implementando uma interface — não precisamos reescrever o sistema."

**Duração:** 3,5 minutos

---

## Slide 8 — Segurança (15:30 – 18:00)

**Objetivo:** Gerar confiança na equipe técnica.

**Mensagem principal:**
> "Segurança em todas as camadas: autenticação, autorização, proteção de transport, auditoria."

**Explicação do apresentador:**
- **JWT:** "Tokens de curta duração, renovação automática"
- **RBAC:** "10 papéis, 30+ permissões — cada vê apenas o que pode"
- **CSRF:** "Proteção contra ataques de falsificação"
- **Auditoria:** "Toda ação é registrada com IP, navegador, data"
- **LGPD:** "Minimização de dados, controls de acesso, logs rastreáveis"

Se houver técnica do SERPRO: "Secrets nunca são persistidos no banco — apenas referenciados via variáveis de ambiente."

**Duração:** 2,5 minutos

---

## Slide 9 — Observabilidade (18:00 – 20:00)

**Objetivo:** Mostrar maturidade operacional.

**Mensagem principal:**
> "Monitoramento completo: saúde, métricas, alertas inteligentes e recuperação automática."

**Explicação do apresentador:**
- **Health Dashboard:** "Status de cada componente em tempo real"
- **Alertas R1–R10:** "Regras automáticas que detectam problemas"
- **Recuperação:** "Sistema se recuperar sozinho quando possível"
- Mostre o dashboard de integrações se disponível

**Duração:** 2 minutos

---

## Slide 10 — Benefícios (20:00 – 22:00)

**Objetivo:** Conectar com os objetivos do negócio.

**Mensagem principal:**
> "Redução de trabalho manual, rastreabilidade completa, transparência total."

**Explicação do apresentador:**
Conecte cada benefício com um problema do Slide 2:
- "Perdíamos prazos? → Alertas automáticos"
- "Não sabíamos o status? → Dashboard em tempo real"
- "Sem auditoria? → Trilha completa"
- "Dados inconsistentes? → Integrações automáticas"
- "Sem indicadores? → Estatísticas e relatórios"

**Duração:** 2 minutos

---

## Slide 11 — Escalabilidade (22:00 – 23:30)

**Objetivo:** Mostrar que o sistema cresce com a necessidade.

**Mensagem principal:**
> "Arquitetura modular pronta para novos sistemas, órgãos e fluxos."

**Explicação do apresentador:**
- "Hoje: Transferegov, SEI, CGLOG"
- "Amanhã: PNCP, Comprasnet, qualquer sistema governamental"
- "Multi-tenant: pronto para múltiplos órgãos"
- "Multi-instância: suporta múltiplas cópias do servidor"

**Duração:** 1,5 minutos

---

## Slide 12 — Roadmap (23:30 – 25:00)

**Objetivo:** Mostrar visão de futuro e compromisso.

**Mensagem principal:**
> "Sistema em constante evolução. Próximos passos: dashboards avançados, métricas, novas integrações."

**Explicação do apresentador:**
- Liste 3-4 itens do roadmap que mais interessem ao público
- "Estamos comprometidos com melhoria contínua"
- "Sugestões de melhorias são bem-vindas"

**Encerramento:**
> "O SGD é uma plataforma sólida, documentada e pronta para operação. Estamos disponíveis para demo ao vivo, esclarecimento de dúvidas e próximos passos."

**Duração:** 1,5 minutos

---

## Resumo de Tempos

| Slide | Título | Início | Fim | Duração |
|-------|--------|--------|-----|---------|
| 1 | Capa | 0:00 | 0:30 | 0:30 |
| 2 | O Problema | 0:30 | 3:00 | 2:30 |
| 3 | A Solução | 3:00 | 5:30 | 2:30 |
| 4 | Arquitetura | 5:30 | 8:00 | 2:30 |
| 5 | Gestão de Demandas | 8:00 | 10:30 | 2:30 |
| 6 | Tempo Real | 10:30 | 12:00 | 1:30 |
| 7 | Integrações | 12:00 | 15:30 | 3:30 |
| 8 | Segurança | 15:30 | 18:00 | 2:30 |
| 9 | Observabilidade | 18:00 | 20:00 | 2:00 |
| 10 | Benefícios | 20:00 | 22:00 | 2:00 |
| 11 | Escalabilidade | 22:00 | 23:30 | 1:30 |
| 12 | Roadmap | 23:30 | 25:00 | 1:30 |
| — | **Total** | — | — | **25:00** |

---

## Dicas para o Apresentador

1. **Comece pelo problema** — crie identificação antes de mostrar a solução
2. **Use exemplos reais** — situações que o público conhece
3. **Evite jargão técnico** — quando necessário, explique em linguagem simples
4. **Mostre o sistema** — se possível, demo ao vivo em 1-2 slides
5. **Encerre com ações** — próximos passos, contatos, disponibilidade
6. **Prepare-se para perguntas** — consulte `perguntas-respostas-serpro.md`
