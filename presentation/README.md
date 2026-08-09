# Apresentação Institucional SGD

## Como gerar o PowerPoint

O conteúdo da apresentação está em `docs/apresentacao-executiva.md`.
Para gerar o `.pptx`, use uma das opções abaixo:

### Opção 1 — Marp (recomendado)

```bash
# Instalar Marp CLI
npm install -g @marp-team/marp-cli

# Gerar PPTX
marp docs/apresentacao-executiva.md --pptx --allow-local-files -o presentation/SGD_Apresentacao_Institucional.pptx
```

### Opção 2 — Pandoc

```bash
# Instalar Pandoc + slideous
pandoc docs/apresentacao-executiva.md -t pptx -o presentation/SGD_Apresentacao_Institucional.pptx
```

### Opção 3 — Conversão manual

1. Abra `docs/apresentacao-executiva.md` no VS Code
2. Instale a extensão "Marp for VS Code"
3. Clique no ícone Marp → "Export Slide Deck" → PowerPoint
4. Salve em `presentation/SGD_Apresentacao_Institucional.pptx`

### Opção 4 — Google Slides

1. Copie o conteúdo de `docs/apresentacao-executiva.md`
2. Cole no Google Slides
3. Formate manualmente (títulos, bullets, imagens)
4. Exporte como `.pptx`

## Estrutura da Apresentação

| Slide | Título | Duração |
|-------|--------|---------|
| 1 | Capa | 0:30 |
| 2 | O Problema | 2:30 |
| 3 | A Solução SGD | 2:30 |
| 4 | Arquitetura | 2:30 |
| 5 | Gestão de Demandas | 2:30 |
| 6 | Tempo Real | 1:30 |
| 7 | Integrações | 3:30 |
| 8 | Segurança | 2:30 |
| 9 | Observabilidade | 2:00 |
| 10 | Benefícios | 2:00 |
| 11 | Escalabilidade | 1:30 |
| 12 | Roadmap | 1:30 |
| — | **Total** | **25:00** |

## Materiais de Apoio

- `docs/roteiro-apresentacao.md` — Script do apresentador
- `docs/perguntas-respostas-serpro.md` — Q&A técnico
- `docs/visao-negocio.md` — Documento executivo de negócio
