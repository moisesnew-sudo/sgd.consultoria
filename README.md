# SGD — Sistema de Gestão de Demandas (Consultoria)

Plataforma estilo CRM para gestão de demandas governamentais.
Frontend (`gruposgd.com.br`) + Backend (`api.gruposgd.com.br`).

## Stack
- **Frontend:** React 19 + Vite 6 + Tailwind v4 + Recharts + lucide-react
- **Backend:** Node + Express + PostgreSQL (pg) + JWT + Zod
- **Testes:** Vitest (43 testes, 7 suites)

## Estrutura
- `frontend/` — app React (deploy Vercel, root = `frontend`, output = `dist`)
- `backend/` — API Express (deploy Render, start = `npm start`)

## Funcionalidades
- **Dashboard como página inicial oficial** — todos os usuários, independentemente do perfil, são direcionados ao Dashboard após o login (visão geral do sistema)
- CRUD de demandas com timeline e anexos
- Dashboard com gráficos (Power BI style)
- Relatórios PDF e Excel
- Controle de usuários (RBAC + permissões granulares)
- Auditoria completa de ações
- Sessões ativas com refresh token rotation
- Backup e restauração
- Monitoramento do sistema
- Calendário de eventos
- Comentários em demandas
- Painel LGPD
- Integrações
- Tema claro/escuro
- Inatividade com bloqueio automático

## Deploy

### Backend (Render)
- Web Service apontando para `backend/`
- Build: `npm install && npm run build`
- Start: `npm start` (usa `tsx src/server.ts`)
- Variáveis de ambiente obrigatórias:
  ```
  NODE_ENV=production
  DATABASE_URL=<postgresql://...>
  JWT_SECRET=<string_32+_caracteres>
  CORS_ORIGIN=<https://gruposgd.com.br,https://www.gruposgd.com.br,http://localhost:3000>
  ```
- Opcionais:
  ```
  PUBLIC_API_URL=https://api.gruposgd.com.br/api
  LOG_LEVEL=info           # debug | info | warn | error
  SEED_DEFAULT_PASSWORD=   # senha padrão do seed
  ```
- `render.yaml` incluído na raiz.

### Frontend (Vercel)
- Root: `frontend`, Framework: Vite, Output: `dist`
- `vercel.json` faz rewrite SPA para `index.html`
- Local: crie `frontend/.env.local` com `VITE_API_URL=http://localhost:3001`

## Desenvolvimento local

```bash
# Backend
cd backend
cp .env.example .env   # edite DATABASE_URL para seu PostgreSQL local
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

## Docker

```bash
docker compose up -d
# Backend em http://localhost:3001
# PostgreSQL em localhost:5433
```

## CI/CD

GitHub Actions configurado (`.github/workflows/ci.yml`):
- Push/PR na main executa lint, build e testes do backend + frontend

## Credenciais seed (personalizáveis via env vars)
- `SEED_ADMIN_PASSWORD`, `SEED_GESTOR_PASSWORD`, etc.
- Padrão: `Sgd@2026!` para todos (se nenhuma variável definida)
