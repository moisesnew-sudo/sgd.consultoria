# SGD — Sistema de Gestão de Demandas (Consultoria)

Plataforma estilo CRM para gestão de demandas governamentais.
Frontend (Vercel) + Backend (Render + PostgreSQL).

## Stack
- **Frontend:** Vite 6 + React 19 + Tailwind v4 + Recharts + lucide-react
- **Backend:** Node + Express + PostgreSQL (pg) + JWT
- **IA:** heurística client-side (sem API externa paga)

## Estrutura
- `frontend/` — app React (deploy Vercel, root = `frontend`, output = `dist`)
- `backend/` — API Express (deploy Render, start = `npm start`)

## Funcionalidades (Roadmap)
- Fase 1: Login sem credenciais demo + edição de demandas com histórico
- Fase 2: Tema claro/escuro/automático + Dashboard estilo Power BI
- Fase 3: Filtros avançados + import/export Excel/CSV/PDF
- Fase 4: Controle de usuários por perfil (admin/gestor/analista/consulta)
- Fase 5: IA (resumo, prioridade, similares, busca, relatório), comentários,
  auditoria, calendário, notificações, API/integrações e backup/restauração

## Deploy

### Backend (Render)
- Web Service apontando para `backend/`
- Build: `npm install && npm run build`
- Start: `npm start` (usa `tsx src/server.ts`)
- Variáveis: `NODE_ENV=production`, `PORT=3001`, `DATABASE_URL`,
  `JWT_SECRET`, `CORS_ORIGIN=*`, `PUBLIC_API_URL=https://sgd-consultoria.onrender.com/api`
- `render.yaml` já incluído na raiz.

### Frontend (Vercel)
- Root: `frontend`, Framework: Vite, Output: `dist`
- `vercel.json` faz rewrite SPA para `index.html`
- Não definir `VITE_API_URL` (usa fallback `https://sgd-consultoria.onrender.com/api`)
- Local: crie `frontend/.env.local` com `VITE_API_URL=http://localhost:3001/api`

## Credenciais demo (seed)
- admin@sgd.gov.br / Admin2026!
- gestor@sgd.gov.br / Gestor2026!
- analista@sgd.gov.br / Analista2026!
- consulta@sgd.gov.br / Visitante2026!
