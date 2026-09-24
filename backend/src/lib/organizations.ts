import { get } from '../database.js';

// ETAPA 2 (AUXAMO) — Camada minima de leitura da entidade organizations.
// Fonte oficial da IDENTIDADE do tenant. Sem secrets aqui.
// Deliberadamente SEM integracao com autenticacao/login e SEM middleware de
// dominio nesta etapa: apenas leitura + validacao para fundacao.

export interface Organization {
  id: number;
  name: string;
  slug: string;
  primary_domain: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

// Slug: lowercase, [a-z0-9-], sem hifen nas bordas, 1..63 chars.
// Mesma regra do CHECK constraint em database.ts (manter sincronizado).
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && slug.length >= 1 && slug.length <= 63 && SLUG_RE.test(slug);
}

export function normalizeSlug(slug: unknown): string | null {
  if (typeof slug !== 'string') return null;
  const normalized = slug.trim().toLowerCase();
  return isValidSlug(normalized) ? normalized : null;
}

function isValidDomainLabel(label: string): boolean {
  return label.length >= 1 && label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label);
}

// Dominio: armazenado lowercase, sem protocolo, sem path, sem porta, sem trailing slash.
// Ex. valido: 'auxamo.example.com'. Invalidos: 'https://...', '.../login', '...:443'.
export function normalizeDomain(domain: unknown): string | null {
  if (typeof domain !== 'string') return null;
  const normalized = domain.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 253) return null;
  if (
    normalized.includes('://') ||
    normalized.includes('/') ||
    normalized.includes(':') ||
    normalized.includes(' ') ||
    normalized.endsWith('.')
  ) {
    return null;
  }
  const labels = normalized.split('.');
  if (!labels.every(isValidDomainLabel)) return null;
  return normalized;
}

export function isValidDomain(domain: unknown): domain is string {
  return normalizeDomain(domain) !== null;
}

export async function getOrganizationById(id: number): Promise<Organization | undefined> {
  if (!Number.isInteger(id) || id < 1) return undefined;
  return get<Organization>('SELECT * FROM organizations WHERE id = $1', [id]);
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | undefined> {
  const normalized = normalizeSlug(slug);
  if (!normalized) return undefined;
  return get<Organization>('SELECT * FROM organizations WHERE slug = $1', [normalized]);
}

export async function getOrganizationByDomain(domain: string): Promise<Organization | undefined> {
  const normalized = normalizeDomain(domain);
  if (!normalized) return undefined;
  return get<Organization>('SELECT * FROM organizations WHERE LOWER(primary_domain) = $1', [normalized]);
}
