import crypto from 'crypto';
import { run } from '../database.js';

const SAFE_COL_RE = /^[a-z_][a-z0-9_]*$/;

export function sanitizeColumnName(col: string): string {
  if (!SAFE_COL_RE.test(col)) {
    throw new Error(`Invalid column name: ${col}`);
  }
  return col;
}

export async function addTimelineEvent(
  demandId: string,
  title: string,
  description: string,
  userName: string,
  statusChangedTo?: string | null,
  eventType: string = 'note',
  details?: Record<string, unknown> | null
): Promise<string> {
  const eventId = `ev-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  await run(
    `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, event_type, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [eventId, demandId, title, description, userName, statusChangedTo || null, eventType, details ? JSON.stringify(details) : null, now]
  );
  return eventId;
}

export function buildUpdateQuery(
  table: string,
  data: Record<string, any>,
  idColumn: string,
  idValue: any
): { sql: string; values: any[] } | null {
  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;
  sanitizeColumnName(idColumn);
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      sanitizeColumnName(col);
      updates.push(`${col} = $${idx++}`);
      values.push(value);
    }
  }
  if (updates.length === 0) return null;
  updates.push('updated_at = NOW()');
  values.push(idValue);
  sanitizeColumnName(table);
  return { sql: `UPDATE ${table} SET ${updates.join(', ')} WHERE ${sanitizeColumnName(idColumn)} = $${idx}`, values };
}
