import { run } from '../database.js';

export async function addTimelineEvent(
  demandId: string,
  title: string,
  description: string,
  userName: string,
  statusChangedTo?: string | null
): Promise<string> {
  const eventId = `ev-${Date.now()}`;
  const now = new Date().toISOString();
  await run(
    `INSERT INTO timeline_events (id, demand_id, title, description, user_name, status_changed_to, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [eventId, demandId, title, description, userName, statusChangedTo || null, now]
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
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      updates.push(`${col} = $${idx++}`);
      values.push(value);
    }
  }
  if (updates.length === 0) return null;
  updates.push('updated_at = NOW()');
  values.push(idValue);
  return { sql: `UPDATE ${table} SET ${updates.join(', ')} WHERE ${idColumn} = $${idx}`, values };
}
