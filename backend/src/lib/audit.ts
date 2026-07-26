import { run } from '../database.js';

export interface AuditEntry {
  entity_type: string;
  entity_id: string;
  action: string;
  user_id?: number;
  user_name?: string;
  details?: any;
  ip_address?: string;
  user_agent?: string;
}

function parseUserAgent(ua?: string): { browser: string; os: string } {
  if (!ua) return { browser: 'Desconhecido', os: 'Desconhecido' };
  let browser = 'Desconhecido';
  let os = 'Desconhecido';

  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Chrome';
  else if (ua.includes('Firefox')) browser = 'Firefox';
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';
  else if (ua.includes('MSIE') || ua.includes('Trident')) browser = 'Internet Explorer';

  if (ua.includes('Windows NT')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Linux') && !ua.includes('Android')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return { browser, os };
}

export function extractMeta(req?: any): { ip_address: string; user_agent: string } {
  const ip_address = req?.headers?.['x-forwarded-for']
    ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
    : req?.socket?.remoteAddress || 'unknown';
  const user_agent = req?.headers?.['user-agent'] || '';
  return { ip_address, user_agent };
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { browser, os } = parseUserAgent(entry.user_agent);
    const details = entry.details || {};
    details._browser = browser;
    details._os = os;
    if (entry.ip_address) details._ip = entry.ip_address;

    await run(
      `INSERT INTO audit_logs (entity_type, entity_id, action, user_id, user_name, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.entity_type, entry.entity_id, entry.action,
        entry.user_id || null, entry.user_name || null,
        JSON.stringify(details),
        entry.ip_address || null,
        entry.user_agent || null
      ]
    );
  } catch (err) {
    console.error('Audit log error (non-fatal):', err);
  }
}

export async function logExport(req: any, user: any, exportType: string, recordCount: number, filters?: any): Promise<void> {
  try {
    const { ip_address } = extractMeta(req);
    await run(
      `INSERT INTO export_logs (user_id, user_name, export_type, record_count, filters, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.name, exportType, recordCount, filters ? JSON.stringify(filters) : null, ip_address]
    );
  } catch (err) {
    console.error('Export log error (non-fatal):', err);
  }
}
