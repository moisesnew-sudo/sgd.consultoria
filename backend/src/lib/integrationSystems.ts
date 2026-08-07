import { z } from 'zod';
import { get, all, run, transaction } from '../database.js';
import { logAudit, extractMeta } from './audit.js';
import { logger } from './logger.js';

const integrationSystemSchema = z.object({
  code: z.string().min(1, 'Code é obrigatório').regex(/^[a-z0-9_-]+$/, 'Code deve conter apenas letras minúsculas, números, _ e -'),
  name: z.string().min(1, 'Nome é obrigatório'),
  description: z.string().optional(),
  secret_env_key: z.string().min(1, 'Variável de ambiente do secret é obrigatória'),
  config: z.record(z.unknown()).optional(),
});

const updateIntegrationSystemSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').optional(),
  description: z.string().optional(),
  config: z.record(z.unknown()).optional(),
}).strict();

export interface IntegrationSystemFilters {
  page?: number;
  limit?: number;
  search?: string;
  active?: boolean;
}

export interface IntegrationSystemResponse {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  secretConfigured: boolean;
}

function mapSystem(row: any): IntegrationSystemResponse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: row.active,
    config: row.config,
    created_at: row.created_at,
    updated_at: row.updated_at,
    secretConfigured: !!row.secret_env_key && !!process.env[row.secret_env_key],
  };
}

function validateConfig(config: unknown): Record<string, unknown> | null {
  if (config === undefined || config === null) return null;
  if (typeof config === 'object') return config as Record<string, unknown>;
  try {
    return JSON.parse(String(config)) as Record<string, unknown>;
  } catch {
    throw new Error('Config deve ser um JSON válido');
  }
}

export async function getAll(filters: IntegrationSystemFilters = {}): Promise<{ data: IntegrationSystemResponse[]; total: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.search) {
    conditions.push(`(code ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`);
    params.push(`%${filters.search}%`);
  }

  if (filters.active !== undefined) {
    conditions.push(`active = $${params.length + 1}`);
    params.push(filters.active);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await get<{ total: string }>(`SELECT COUNT(*) as total FROM integration_systems ${whereClause}`, params);
  const total = parseInt(countResult?.total ?? '0', 10);

  params.push(limit, offset);
  const limitParam = params.length - 1;
  const offsetParam = params.length;

  const rows = await all<any>(
    `SELECT id, code, name, description, active, config, created_at, updated_at, secret_env_key
     FROM integration_systems
     ${whereClause}
     ORDER BY name ASC
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );

  return {
    data: rows.map(mapSystem),
    total,
  };
}

export async function getById(id: number): Promise<IntegrationSystemResponse | null> {
  const row = await get<any>(
    `SELECT id, code, name, description, active, config, created_at, updated_at, secret_env_key
     FROM integration_systems
     WHERE id = $1`,
    [id]
  );

  if (!row) return null;

  return mapSystem(row);
}

export async function create(data: z.infer<typeof integrationSystemSchema>, user: any): Promise<IntegrationSystemResponse> {
  const validated = integrationSystemSchema.parse(data);

  const existingCode = await get<{ id: number }>(
    `SELECT id FROM integration_systems WHERE UPPER(code) = UPPER($1)`,
    [validated.code]
  );

  if (existingCode) {
    throw new Error('Já existe um sistema com este code');
  }

  const config = validateConfig(validated.config);

  const result = await transaction(async (client) => {
    const insertResult = await client.query<any>(
      `INSERT INTO integration_systems (code, name, description, secret_env_key, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, description, active, config, created_at, updated_at, secret_env_key`,
      [validated.code, validated.name, validated.description ?? null, validated.secret_env_key, config ? JSON.stringify(config) : null]
    );

    const system = insertResult.rows[0];

    await logAudit(
      {
        entity_type: 'integration_system',
        entity_id: String(system.id),
        action: 'integration.system.created',
        user_id: user.id,
        user_name: user.name,
        details: {
          system: { ...system, secret_env_key: '[REDACTED]', config },
        },
        ...extractMeta(user.req),
      },
      client
    );

    await client.query(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message)
       VALUES ($1, $2, 'out', 'integration.system.created', 'success', $3)`,
      [system.id, system.code, `Sistema ${system.code} criado por ${user.name}`]
    );

    return system;
  });

  return mapSystem(result);
}

export async function update(id: number, data: z.infer<typeof updateIntegrationSystemSchema>, user: any): Promise<IntegrationSystemResponse> {
  const validated = updateIntegrationSystemSchema.parse(data);

  const existing = await get<any>(
    `SELECT id, code, name, description, active, config, created_at, updated_at, secret_env_key
     FROM integration_systems
     WHERE id = $1`,
    [id]
  );

  if (!existing) {
    throw new Error('Sistema não encontrado');
  }

  const config = validateConfig(validated.config ?? existing.config);

  const result = await transaction(async (client) => {
    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (validated.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(validated.name);
    }
    if (validated.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(validated.description);
    }
    if (config !== undefined) {
      updates.push(`config = $${idx++}`);
      params.push(config ? JSON.stringify(config) : null);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const updateResult = await client.query<any>(
      `UPDATE integration_systems
       SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING id, code, name, description, active, config, created_at, updated_at, secret_env_key`,
      params
    );

    const updated = updateResult.rows[0];

    await logAudit(
      {
        entity_type: 'integration_system',
        entity_id: String(id),
        action: 'integration.system.updated',
        user_id: user.id,
        user_name: user.name,
        details: {
          before: { ...existing, secret_env_key: '[REDACTED]' },
          after: { ...updated, secret_env_key: '[REDACTED]', config },
        },
        ...extractMeta(user.req),
      },
      client
    );

    await client.query(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message)
       VALUES ($1, $2, 'out', 'integration.system.updated', 'success', $3)`,
      [updated.id, updated.code, `Sistema ${updated.code} atualizado por ${user.name}`]
    );

    return updated;
  });

  return mapSystem(result);
}

export async function setActive(id: number, active: boolean, user: any): Promise<IntegrationSystemResponse> {
  const existing = await get<any>(
    `SELECT id, code, name, description, active, config, created_at, updated_at, secret_env_key
     FROM integration_systems
     WHERE id = $1`,
    [id]
  );

  if (!existing) {
    throw new Error('Sistema não encontrado');
  }

  if (existing.active === active) {
    return mapSystem(existing);
  }

  const action = active ? 'integration.system.activated' : 'integration.system.deactivated';
  const message = active ? 'ativado' : 'desativado';

  const result = await transaction(async (client) => {
    const updateResult = await client.query<any>(
      `UPDATE integration_systems
       SET active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, code, name, description, active, config, created_at, updated_at, secret_env_key`,
      [active, id]
    );

    const updated = updateResult.rows[0];

    await logAudit(
      {
        entity_type: 'integration_system',
        entity_id: String(id),
        action,
        user_id: user.id,
        user_name: user.name,
        details: {
          before: { ...existing, secret_env_key: '[REDACTED]' },
          after: { ...updated, secret_env_key: '[REDACTED]' },
        },
        ...extractMeta(user.req),
      },
      client
    );

    await client.query(
      `INSERT INTO integration_logs (system_id, system_code, direction, action, status, message)
       VALUES ($1, $2, 'out', $3, 'success', $4)`,
      [updated.id, updated.code, action, `Sistema ${updated.code} ${message} por ${user.name}`]
    );

    return updated;
  });

  return mapSystem(result);
}