import { Request, Response, NextFunction } from 'express';
import {
  getOrganizationById,
  getOrganizationByDomain,
  normalizeDomain,
  type Organization,
} from '../lib/organizations.js';

// ETAPA 3 (AUXAMO) — Resolucao segura de organization por Host.
// MODELO DE CONFIANCA (politica explicita):
//   - Fonte UNICA: header `Host` da conexao direta (req.headers.host).
//   - `X-Forwarded-Host` NUNCA e usado: com `trust proxy = 1` apenas o ultimo
//     salto (Render) e confiavel, e o XFH pode ter sido injetado pelo cliente
//     antes do proxy. Render + Cloudflare preservam o Host original fim a fim.
//   - `Origin`/`Referer` NUNCA resolvem tenant (servem apenas a validacao
//     anti-CSRF existente em server.ts). NUNCA ha fallback para tenant 1.
//   - Cliente NAO escolhe tenant via body, query, headers customizados
//     (X-Tenant-Id e ignorado), tenantId ou slug.
// CLASSIFICACAO DE ROTAS (montagem futura, ETAPA 4+ — NADA montado aqui):
//   A. tenant-aware (demands, attachments, etc.): montar ANTES de authenticateToken.
//   B. /api/health e /api/health/ready: NUNCA montar (liveness sem tenant).
//   C. publicas sem tenant: nao montar.
//   D. /api/auth/*: NAO montar nesta etapa (login segue com tenantId; ETAPA 4 vincula).
//   E. webhooks inbound: NAO montar (tenant vem da row integration_systems).
//   F. admin futuro: montar quando existir.
// DECISOES ETAPA 3.1 (pre-requisito do commit; ver docs/auxamo-tenant-resolution.md):
//   - `primary_domain` = dominio que chega AO BACKEND (API-domain), nunca o do frontend.
//   - PROIBIDO cadastrar hostname compartilhado (ex.: api.gruposgd.com.br) como
//     primary_domain: sob API compartilhada o Host e igual para todos os tenants
//     e o resolver rotearia tudo para uma unica org (tenant confusion).
//   - Middleware DESMONTADO de producao ate existirem API hostnames por tenant
//     (Modelo B: api.<org> apontando para o mesmo servico). Sob API compartilhada,
//     a autoridade de tenant continua sendo exclusivamente o JWT assinado.

export interface OrganizationContext {
  id: number;
  name: string;
  slug: string;
  primary_domain: string | null;
  status: 'active' | 'inactive';
}

declare global {
  namespace Express {
    interface Request {
      organization?: OrganizationContext;
    }
  }
}

export type OrganizationResolution =
  | { status: 'resolved'; organization: Organization }
  | { status: 'inactive'; organization: Organization }
  | { status: 'unknown' }
  | { status: 'invalid' };

const MAX_HOST_LENGTH = 259; // 253 (hostname) + ':' + 5 (porta)
const IPV4_RE = /^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$/;

// Normaliza o Host cru em hostname canonico ou null (rejeitado).
// Regras: lowercase; porta numerica removida; protocolo/path/query/fragment,
// multiplos hosts, whitespace/controles (CR/LF), '@', IPv6 com colchetes e
// host vazio/duplo sao rejeitados. Labels validados por normalizeDomain
// (DNS, IPv4 e 'localhost' passam; resto rejeitado).
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > MAX_HOST_LENGTH) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F\s]/.test(raw)) return null;
  if (raw.includes(',')) return null;
  if (raw.includes('://')) return null;
  if (/[\/?#@]/.test(raw)) return null;
  if (raw.startsWith('[')) return null; // IPv6 literal: explicitamente nao suportado.

  let hostname = raw;
  const lastColon = raw.lastIndexOf(':');
  if (lastColon !== -1) {
    const namePart = raw.slice(0, lastColon);
    const portPart = raw.slice(lastColon + 1);
    // ':' residual no nome (IPv6 sem colchetes) ou porta ausente/nao numerica: rejeita.
    if (namePart.length === 0 || namePart.includes(':')) return null;
    if (!/^[0-9]{1,5}$/.test(portPart)) return null;
    hostname = namePart;
  }

  const normalized = normalizeDomain(hostname);
  if (!normalized) return null;
  // normalizeDomain aceita single-label; restringe a 'localhost' ou IPv4 para
  // nao aceitar lixo de label unica como hostname de tenant.
  if (!normalized.includes('.') && normalized !== 'localhost' && !IPV4_RE.test(normalized)) {
    return null;
  }
  return normalized;
}

function toContext(org: Organization): OrganizationContext {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    primary_domain: org.primary_domain,
    status: org.status,
  };
}

// Desenvolvimento/teste: 'localhost' e 127.0.0.1 resolvem explicitamente para
// a org 1, SOMENTE fora de producao. Producao nunca tem fallback.
function isLocalDevHost(host: string): boolean {
  return (
    process.env.NODE_ENV !== 'production' && (host === 'localhost' || host === '127.0.0.1')
  );
}

export async function resolveOrganizationFromRequest(req: Request): Promise<OrganizationResolution> {
  const host = normalizeHost(req.headers.host);
  if (!host) return { status: 'invalid' };

  if (isLocalDevHost(host)) {
    const local = await getOrganizationById(1);
    if (!local) return { status: 'unknown' };
    return local.status === 'active'
      ? { status: 'resolved', organization: local }
      : { status: 'inactive', organization: local };
  }

  const organization = await getOrganizationByDomain(host);
  if (!organization) return { status: 'unknown' };
  return organization.status === 'active'
    ? { status: 'resolved', organization }
    : { status: 'inactive', organization };
}

// Middleware reutilizavel. NAO montado globalmente (ver classificacao acima).
// resolved -> req.organization + next(); inactive -> 403; unknown -> 404;
// invalid (Host malformado) -> 400. Erros sempre sanitizados, sem enumeracao
// alem da distincao de status exigida. Erro de banco segue para o error
// handler da aplicacao (resposta sanitizada padrao).
export async function resolveOrganization(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await resolveOrganizationFromRequest(req);
    if (result.status === 'resolved') {
      req.organization = toContext(result.organization);
      return next();
    }
    if (result.status === 'inactive') {
      return res.status(403).json({ error: 'Organização inativa. Entre em contato com o suporte.' });
    }
    if (result.status === 'invalid') {
      return res.status(400).json({ error: 'Host inválido.' });
    }
    return res.status(404).json({ error: 'Organização não encontrada para este domínio.' });
  } catch (err) {
    return next(err);
  }
}
