import { run } from '../database.js';

export async function logAudit(params: {
  entity_type: string;
  entity_id: string;
  action: string;
  user_id?: number | null;
  user_name?: string;
  details?: any;
}): Promise<void> {
  try {
    await run(
      `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, user_name, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        params.entity_type,
        params.entity_id,
        params.action,
        params.user_id ?? null,
        params.user_name ?? null,
        params.details ? JSON.stringify(params.details) : null
      ]
    );
  } catch (e) {
    console.error('Audit log failed (non-fatal):', e);
  }
}
