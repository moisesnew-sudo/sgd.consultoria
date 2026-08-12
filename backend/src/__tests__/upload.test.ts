// Limite pequeno para permitir testar 413 sem alocar dezenas de MB.
// Precisa ser definido ANTES da importação do servidor (upload.ts lê o env no import).
process.env.MAX_UPLOAD_SIZE_MB = '1';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import type { SuperAgentTest } from 'supertest';
import { run, all, get } from '../database.js';

const { loginAsWithCsrf, admin } = await import('./helpers.js');
const app = (await import('../server.js')).default;
const { cleanupOrphanedFiles } = await import('../routes/upload.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const PDF_CONTENT = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const MALICIOUS_NAME = '../../etc/passwd.pdf';

const CONSULTA_EMAIL = 'upload.consulta@test.local';
const VISITANTE_EMAIL = 'upload.visitante@test.local';
const TEST_PASSWORD = 'UploadTest2026!';

const createdDemandIds: string[] = [];
const createdUserEmails: string[] = [];
const createdAttachmentIds: number[] = [];

function doUpload(
  agent: SuperAgentTest,
  csrfToken: string,
  demandId: string,
  opts: { filename?: string; contentType?: string; content?: Buffer } = {}
) {
  const { filename = 'teste.pdf', contentType = 'application/pdf', content = PDF_CONTENT } = opts;
  return agent
    .post(`/api/demands/${demandId}/attachments`)
    .set('X-CSRF-Token', csrfToken)
    .attach('files', content, { filename, contentType });
}

async function createDemand(agent: SuperAgentTest, csrfToken: string): Promise<string> {
  const res = await agent
    .post('/api/demands')
    .set('X-CSRF-Token', csrfToken)
    .send({
      title: `DEMANDA UPLOAD ${Date.now()}`,
      category: 'INFRAESTRUTURA',
      municipality: 'SOBRAL',
      uf: 'CE',
      organ: 'MEC',
      requested_value: 1000,
      priority: 'media',
      status: 'pendente',
    });
  expect(res.status).toBe(201);
  const id = res.body.id as string;
  createdDemandIds.push(id);
  return id;
}

async function createTestUser(email: string, role: string): Promise<void> {
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);
  await run(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
    [email, hash, `Upload Test ${role}`, role]
  );
  createdUserEmails.push(email);
}

describe('Upload de Anexos - endpoints de attachments', () => {
  let agent: SuperAgentTest;
  let csrf: string;
  let demandId: string;
  let adminUserId: number;
  let consultaAgent: SuperAgentTest;
  let consultaCsrf: string;
  let visitanteAgent: SuperAgentTest;

  beforeAll(async () => {
    const login = await loginAsWithCsrf(admin.email, admin.password);
    agent = login.agent;
    csrf = login.csrfToken;
    demandId = await createDemand(agent, csrf);
    adminUserId = (await get('SELECT id FROM users WHERE email = $1', [admin.email]))!.id as number;

    await createTestUser(CONSULTA_EMAIL, 'consulta');
    await createTestUser(VISITANTE_EMAIL, 'visitante');
    const consultaLogin = await loginAsWithCsrf(CONSULTA_EMAIL, TEST_PASSWORD);
    consultaAgent = consultaLogin.agent;
    consultaCsrf = consultaLogin.csrfToken;
    visitanteAgent = (await loginAsWithCsrf(VISITANTE_EMAIL, TEST_PASSWORD)).agent;
  });

  afterAll(async () => {
    const rows = await all<{ id: number; file_path: string | null }>(
      'SELECT id, file_path FROM attachments WHERE id = ANY($1::int[])',
      [createdAttachmentIds]
    );
    for (const r of rows) {
      if (r.file_path) {
        const p = path.join(UPLOAD_DIR, path.basename(r.file_path));
        if (fs.existsSync(p)) fs.unlinkSync(p);
      }
    }
    if (createdAttachmentIds.length > 0) {
      await run('DELETE FROM attachments WHERE id = ANY($1::int[])', [createdAttachmentIds]);
    }
    if (createdDemandIds.length > 0) {
      await run('DELETE FROM demands WHERE id = ANY($1::text[])', [createdDemandIds]);
    }
    if (createdUserEmails.length > 0) {
      await run('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))', [createdUserEmails]);
      await run('DELETE FROM active_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))', [createdUserEmails]);
      await run('DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1::text[]))', [createdUserEmails]);
      await run('DELETE FROM login_attempts WHERE email = ANY($1::text[])', [createdUserEmails]);
      await run('DELETE FROM users WHERE email = ANY($1::text[])', [createdUserEmails]);
    }
    // Remove arquivos órfãos criados durante o teste (ex.: falha de upload/demanda inexistente)
    const remaining = await all<{ file_path: string }>(
      'SELECT file_path FROM attachments WHERE file_path IS NOT NULL'
    );
    const referenced = new Set(remaining.map(r => r.file_path));
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
      if (!referenced.has(f)) {
        try {
          fs.unlinkSync(path.join(UPLOAD_DIR, f));
        } catch { /* não crítico */ }
      }
    }
  });

  it('permite upload autenticado e persiste o anexo associado ao demand_id', async () => {
    const res = await doUpload(agent, csrf, demandId, { filename: 'proposta.pdf' });
    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    const att = res.body[0];
    expect(att.id).toBeDefined();
    expect(att.demand_id).toBe(demandId);
    expect(att.name).toBe('proposta.pdf');
    expect(att.mime_type).toBe('application/pdf');
    expect(Number(att.file_size)).toBe(PDF_CONTENT.length);
    expect(att.uploaded_by).toBe(adminUserId);
    createdAttachmentIds.push(att.id);

    const diskPath = path.join(UPLOAD_DIR, att.file_path);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath).equals(PDF_CONTENT)).toBe(true);

    const row = await get('SELECT demand_id FROM attachments WHERE id = $1', [att.id]);
    expect(row.demand_id).toBe(demandId);

    const detail = await agent.get(`/api/demands/${demandId}`).set('X-CSRF-Token', csrf);
    expect(detail.status).toBe(200);
    expect(detail.body.attachments.some((x: any) => x.id === att.id && x.demand_id === demandId)).toBe(true);
  });

  it('rejeita upload sem autenticação (bloqueado antes mesmo de alcançar a rota)', async () => {
    const res = await request(app)
      .post(`/api/demands/${demandId}/attachments`)
      .attach('files', PDF_CONTENT, { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(403);
  });

  it('retorna 404 para upload em demanda inexistente e não persiste registro', async () => {
    const missingDemandId = `INEXISTENTE-${Date.now()}`;
    const before = fs.readdirSync(UPLOAD_DIR).length;
    const res = await doUpload(agent, csrf, missingDemandId, { filename: 'semdemanda.pdf' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('não encontrada');
    const after = fs.readdirSync(UPLOAD_DIR).length;
    // Defeito documentado: o arquivo gravado pelo multer fica órfão no disco
    // (nenhum mecanismo remove arquivos cujo INSERT nunca aconteceu).
    expect(after).toBe(before + 1);
    const rows = await all('SELECT id FROM attachments WHERE demand_id = $1', [missingDemandId]);
    expect(rows.length).toBe(0);
  });

  it('retorna 400 quando nenhum arquivo é enviado', async () => {
    const res = await agent.post(`/api/demands/${demandId}/attachments`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Nenhum arquivo');
  });

  it('rejeita MIME não permitido', async () => {
    const res = await doUpload(agent, csrf, demandId, { filename: 'malware.exe', contentType: 'application/x-msdownload' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('não permitido');
  });

  it('rejeita extensão não permitida mesmo quando o MIME é permitido', async () => {
    const res = await doUpload(agent, csrf, demandId, { filename: 'script.exe', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('não permitido');
  });

  it('retorna 413 para arquivo acima do limite de tamanho', async () => {
    const big = Buffer.alloc(2 * 1024 * 1024, 1);
    const res = await doUpload(agent, csrf, demandId, { filename: 'grande.pdf', content: big });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain('grande');
  });

  it('limita a quantidade de arquivos por requisição (máx. 10)', async () => {
    const req = agent.post(`/api/demands/${demandId}/attachments`).set('X-CSRF-Token', csrf);
    for (let i = 0; i < 11; i++) {
      req.attach('files', PDF_CONTENT, { filename: `f${i}.pdf`, contentType: 'application/pdf' });
    }
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('10 arquivos');
  });

  it('permite download autorizado com conteúdo e headers corretos', async () => {
    const up = await doUpload(agent, csrf, demandId, { filename: 'download.pdf' });
    expect(up.status).toBe(201);
    const att = up.body[0];
    createdAttachmentIds.push(att.id);
    const res = await agent.get(`/api/attachments/${att.id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.body.toString()).toBe(PDF_CONTENT.toString());
  });

  it('rejeita download sem permissão (visitante não possui demands.view)', async () => {
    const up = await doUpload(agent, csrf, demandId);
    expect(up.status).toBe(201);
    const att = up.body[0];
    createdAttachmentIds.push(att.id);
    const res = await visitanteAgent.get(`/api/attachments/${att.id}`);
    expect(res.status).toBe(403);
  });

  it('retorna 404 para anexo inexistente', async () => {
    const res = await agent.get('/api/attachments/-999999');
    expect(res.status).toBe(404);
  });

  it('permite excluir anexo (remove registro e arquivo do disco)', async () => {
    const up = await doUpload(agent, csrf, demandId, { filename: 'remover.pdf' });
    expect(up.status).toBe(201);
    const att = up.body[0];
    const diskPath = path.join(UPLOAD_DIR, att.file_path);
    expect(fs.existsSync(diskPath)).toBe(true);

    const res = await agent.delete(`/api/attachments/${att.id}`).set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);

    const row = await get('SELECT id FROM attachments WHERE id = $1', [att.id]);
    expect(row).toBeUndefined();
    expect(fs.existsSync(diskPath)).toBe(false);
  });

  it('rejeita exclusão sem permissão (consulta não possui demands.edit)', async () => {
    const up = await doUpload(agent, csrf, demandId);
    expect(up.status).toBe(201);
    const att = up.body[0];
    createdAttachmentIds.push(att.id);
    const res = await consultaAgent.delete(`/api/attachments/${att.id}`).set('X-CSRF-Token', consultaCsrf);
    expect(res.status).toBe(403);
  });

  it('sanitiza o nome malicioso no download e mantém o arquivo em diretório seguro', async () => {
    // O superagent sanitiza o filename do multipart; para exercitar o caminho de
    // segurança do servidor, injetamos um originalname malicioso diretamente no banco.
    const evilFile = `${crypto.randomBytes(8).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, evilFile), PDF_CONTENT);
    const result = await run(
      `INSERT INTO attachments (demand_id, name, size, type, file_path, mime_type, file_size)
       VALUES ($1, $2, '1.0 MB', 'application/pdf', $3, 'application/pdf', $4) RETURNING id`,
      [demandId, MALICIOUS_NAME, evilFile, PDF_CONTENT.length]
    );
    const attId = result.rows[0].id as number;
    createdAttachmentIds.push(attId);

    const res = await agent.get(`/api/attachments/${attId}`);
    expect(res.status).toBe(200);
    const cd = res.headers['content-disposition'];
    expect(cd).toContain('attachment');
    expect(cd).toContain('.._.._etc_passwd.pdf');
    expect(cd).not.toContain('../');
  });

  it('bloqueia download quando file_path tenta escapar do diretório de uploads', async () => {
    const result = await run(
      `INSERT INTO attachments (demand_id, name, size, type, file_path)
       VALUES ($1, 'evil', '1.0 MB', 'text/plain', '../server.ts') RETURNING id`,
      [demandId]
    );
    const evilId = result.rows[0].id as number;
    createdAttachmentIds.push(evilId);
    const res = await agent.get(`/api/attachments/${evilId}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Acesso negado');
  });

  it('retorna 500 se falhar ao ler o arquivo do disco e não persiste registro', async () => {
    const original = fs.readFileSync;
    fs.readFileSync = (() => { throw new Error('simulated disk failure'); }) as typeof fs.readFileSync;
    try {
      const res = await doUpload(agent, csrf, demandId, { filename: 'falha.pdf' });
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('upload');
    } finally {
      fs.readFileSync = original;
    }
    const rows = await all('SELECT id FROM attachments WHERE name = $1', ['falha.pdf']);
    expect(rows.length).toBe(0);
  });

  it('cleanupOrphanedFiles remove arquivos e registros soft-deleted antigos', async () => {
    const orphanFile = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    fs.writeFileSync(path.join(UPLOAD_DIR, orphanFile), PDF_CONTENT);
    const result = await run(
      `INSERT INTO attachments (demand_id, name, size, type, file_path, deleted_at)
       VALUES ($1, 'orphan', '1.0 MB', 'application/pdf', $2, NOW() - INTERVAL '8 days') RETURNING id`,
      [demandId, orphanFile]
    );
    const orphanId = result.rows[0].id as number;
    await cleanupOrphanedFiles();
    const row = await get('SELECT id FROM attachments WHERE id = $1', [orphanId]);
    expect(row).toBeUndefined();
    expect(fs.existsSync(path.join(UPLOAD_DIR, orphanFile))).toBe(false);
  });

  it('cleanupOrphanedFiles preserva registros válidos', async () => {
    const up = await doUpload(agent, csrf, demandId, { filename: 'mantido.pdf' });
    expect(up.status).toBe(201);
    const att = up.body[0];
    createdAttachmentIds.push(att.id);
    await cleanupOrphanedFiles();
    const row = await get('SELECT id FROM attachments WHERE id = $1', [att.id]);
    expect(row).toBeDefined();
    expect(fs.existsSync(path.join(UPLOAD_DIR, att.file_path))).toBe(true);
  });
});
