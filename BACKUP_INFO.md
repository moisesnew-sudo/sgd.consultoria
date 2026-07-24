# CGASI.SE - Backup Manifesto

## Informações do Backup

| Campo | Valor |
|-------|-------|
| **Data** | 2026-07-22 |
| **Hora** | 21:30 (BRT) |
| **Versão** | v1.0 |
| **Autor** | Engenharia de Software Sênior |
| **Git Commit** | `8686378` |
| **Branch** | `main` |

## Resumo das Funcionalidades

Sistema de Gestão de Demandas (SGD) da **CGASI.SE** — Coordenação Geral de Articulação e Supervisão Institucional da Secretaria Executiva / MAPA.

### Funcionalidades Implementadas

- **Autenticação** — Login com JWT, proteção de rotas, 4 perfis (admin, gestor, analista, consulta)
- **CRUD de Demandas** — Cadastro, edição, exclusão, linha do tempo, comentários, anexos
- **Dashboard** — KPIs (total, em andamento, concluídas, valor solicitado, municípios, vencidas, ticket médio), gráficos (barras, pizza, evolução mensal), rankings (municípios, programas)
- **Relatórios** — Relatório executivo com exportação CSV/JSON, filtros por UF/status/prioridade/ano
- **Calendário** — Visualização de demandas em formato calendário
- **Sidebar** — Navegação responsiva com indicador de demandas pendentes, alternador de tema, badge de perfil
- **Usuários** — Gerenciamento de usuários, perfis, ativação/desativação
- **Municípios** — Cadastro e gestão de municípios por UF
- **Settings** — Configurações de aparência, alteração de senha, exportação de dados
- **Backup** — Exportação completa de dados do sistema
- **Auditoria** — Log de ações dos usuários
- **Integração** — Documentação da API REST com endpoints, token e exemplos cURL
- **Importação/Exportação** — Importação de planilhas (XLSX/CSV), exportação para PDF
- **Temas** — Claro, Escuro e Automático
- **IA** — Busca inteligente por linguagem natural, sumarização e sugestão de prioridade
- **Toast Notifications** — Feedback visual para operações CRUD
- **Skeleton Loading** — Loading states para tabelas e cards
- **Confirm Modal** — Confirmação antes de exclusões

## Tecnologias Utilizadas

### Front-end
- **React** 19.1.0
- **TypeScript** 5.7
- **Vite** 6.4.3
- **Tailwind CSS** 4
- **Recharts** 2.15
- **Lucide React** (ícones)
- **XLSX** (planilhas)

### Back-end
- **Node.js** (runtime)
- **Express** (framework HTTP)
- **TypeScript** 5.7
- **pg** (PostgreSQL driver)
- **bcryptjs** (hash de senhas)
- **jsonwebtoken** (JWT)
- **zod** (validação de schemas)
- **cors** / **helmet** / **morgan**

### Infraestrutura
- **GitHub** (controle de versão)
- **Vercel** (deploy front-end)
- **Render** (deploy back-end e banco PostgreSQL)
- **Banco:** PostgreSQL

## Estrutura do Projeto

```
sgd.consultoria/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/          # Card, Skeleton, ConfirmModal
│   │   │   ├── reports/     # Utilitários de relatório
│   │   │   ├── AuditView.tsx
│   │   │   ├── BackupView.tsx
│   │   │   ├── CalendarView.tsx
│   │   │   ├── DashboardView.tsx
│   │   │   ├── DemandsView.tsx
│   │   │   ├── ExecutiveReport.tsx
│   │   │   ├── ImportExportBar.tsx
│   │   │   ├── IntegrationView.tsx
│   │   │   ├── LoginView.tsx
│   │   │   ├── MunicipalitiesView.tsx
│   │   │   ├── NewDemandView.tsx
│   │   │   ├── ReportsView.tsx
│   │   │   ├── SettingsView.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── UsersView.tsx
│   │   ├── contexts/        # AuthContext, ThemeContext, ToastContext
│   │   ├── hooks/           # useApi
│   │   ├── lib/             # ai.ts
│   │   ├── services/        # api.ts
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── main.tsx
│   │   ├── types.ts
│   │   └── vite-env.d.ts
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── vercel.json
│
├── backend/
│   ├── src/
│   │   ├── lib/             # audit.ts
│   │   ├── middleware/      # auth.ts
│   │   ├── routes/          # demands, auth, comments, audit, etc.
│   │   ├── database.ts      # Conexão + schema PostgreSQL
│   │   ├── seed.ts          # Dados iniciais
│   │   ├── server.ts        # Entry point Express
│   │   └── types.ts
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
│
├── README.md
├── render.yaml
└── .gitignore
```

## Últimas Alterações Realizadas (5 commits)

1. **`8686378`** — Reforma identidade visual: paleta verde MAPA/Gov.br (indigo/violet → brand-*)
2. **`1df322d`** — Fix: ReportsView KPIs R$ 0,00 — Number() em todas as operações reduce
3. **`58db3c6`** — Fix: restrição Zod ano removida, validação aprimorada
4. **`4fde41d`** — Fix: sidebar truncation — w-72, sem line-clamp, padding ajustado
5. **`4cfdb4f`** — Overhaul UI/UX: Toast, Skeleton, Sidebar, Dashboard KPIs, CSS tokens

---

## Instruções para Restauração

### 1. Instalar Dependências

```bash
# Front-end
cd frontend
npm install

# Back-end
cd backend
npm install
```

### 2. Configurar Variáveis de Ambiente

Copie `.env.example` para `.env` no diretório `backend/` e preencha:

```env
PORT=3001
DATABASE_URL=postgresql://usuario:senha@host:5432/sgd_db
JWT_SECRET=sua_chave_secreta_aqui
NODE_ENV=development
```

### 3. Iniciar o Banco de Dados

O schema é auto-criado na inicialização pelo `database.ts`. Para popular dados iniciais:

```bash
cd backend
npx ts-node src/seed.ts
```

### 4. Iniciar o Front-end (dev)

```bash
cd frontend
npm run dev
```

Acessar: http://localhost:5173

### 5. Iniciar o Back-end (dev)

```bash
cd backend
npm run dev
```

Acessar: http://localhost:3001

### 6. Publicar na Vercel (Front-end)

```bash
cd frontend
npm run build
npx vercel --prod
```

Ou conectar o repositório GitHub no painel da Vercel (deploy automático no branch `main`).

### 7. Publicar no Render (Back-end)

1. Criar Web Service no Render conectado ao repositório
2. Configurar:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
3. Adicionar variáveis de ambiente no painel do Render:
   - `DATABASE_URL` (PostgreSQL do Render)
   - `JWT_SECRET`
   - `NODE_ENV=production`
4. Criar banco PostgreSQL no Render e copiar a URL interna

---

## Notas

- O front-end espera o back-end em `http://localhost:3001` em desenvolvimento
- Em produção, a URL da API é configurada via variável de ambiente `VITE_API_URL`
- O banco PostgreSQL é criado automaticamente com todas as tabelas na primeira execução do servidor
- Usuário admin padrão do seed: `admin@cgasi.se` / `admin123`

---

*Backup gerado em 2026-07-22 às 21:30 (BRT)*
*Sistema apto para produção — build front-end 2276 modules, back-end tsc sem erros*
