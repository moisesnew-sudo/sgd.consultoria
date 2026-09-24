# AUXAMO — Resolução de Tenant por Domínio (ETAPA 3 / 3.1)

Decisão arquitetural consolidada na ETAPA 3.2. Não alterar sem revisão de segurança.

## 1. Topologia atual (validada)

- Frontend (Vercel, SPA): `gruposgd.com.br` / `www.gruposgd.com.br`. `vercel.json` só tem
  fallback SPA — **nenhum proxy `/api`**.
- Backend (Render, serviço único `sgd-backend`): `https://api.gruposgd.com.br`.
- Frontend chama a API por fetch direto cross-origin (`VITE_API_URL`), com cookies
  (`COOKIE_DOMAIN=gruposgd.com.br`, apex) e CSRF.
- **Host que chega ao backend: sempre `api.gruposgd.com.br`** (em dev, `localhost:3001`
  via proxy do Vite). O Host nunca identifica o frontend de origem.

## 2. Consequência

Com frontends `sgd.`/`auxamo.` chamando a API compartilhada (Modelo A), o backend
recebe o mesmo Host para todos os tenants. **Resolução por Host é impossível nessa
topologia** — a autoridade de tenant permanece sendo exclusivamente o JWT assinado.

## 3. Modelo adotado (B)

API hostnames por organização apontando para o **mesmo** serviço Render (uma
codebase, zero duplicação). Exemplo conceitual: `api.sgd.gruposgd.com.br` e
`api.auxamo.gruposgd.com.br` como CNAMEs do serviço atual. Pré-requisitos
operacionais futuros (não executar agora): DNS, custom domains no Render e
`CORS_ORIGIN` acrescido das origins dos frontends. `COOKIE_DOMAIN` apex já cobre
os subdomínios.

## 4. Semântica de `organizations.primary_domain`

`primary_domain` = **domínio que chega ao backend** (API-domain). Nunca o domínio
do frontend. Domínio(s) de frontend serão campo separado no futuro
(`frontend_domain`/`frontend_origins`), usado para CORS, cookies e links.

## 5. Proibições operacionais

1. **Nunca** cadastrar hostname compartilhado (ex.: `api.gruposgd.com.br`) como
   `primary_domain` de qualquer org — rotearia todo o tráfego para um tenant
   (tenant confusion garantido).
2. **Nunca** montar o resolver para decisões de tenant sob API compartilhada.
3. **Nunca** usar `Origin`, `Referer`, `X-Tenant-Id` ou `tenantId` (body/query)
   como autoridade de tenant — no máximo defesa auxiliar.
4. **Nunca** `X-Forwarded-Host` como fonte (só o último salto é confiável).
5. **Nunca** fallback para tenant 1.

## 6. Estado do código

`backend/src/middleware/organizationResolver.ts` — implementado e testado
(19 testes), **desmontado de produção**. Montagem prevista: rotas tenant-aware
(antes de `authenticateToken`) quando os API hostnames por tenant existirem;
nunca em `/api/health`, `/api/health/ready`, `/api/auth/*` (nesta fase) ou
webhooks inbound. ETAPA 4 vinculará `req.organization` × `tenant_id` do JWT.
