import { Router, Request, Response } from 'express';
import multer, { FileFilterCallback } from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { get, run, all } from '../database.js';
import { Attachment } from '../types.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { logAudit, extractMeta } from '../lib/audit.js';
import { logger } from '../lib/logger.js';
import { addTimelineEvent } from '../lib/helpers.js';

const ORPHAN_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50', 10) * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png', 'image/jpeg', 'image/gif',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-rar-compressed',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.png', '.jpg', '.jpeg', '.gif',
  '.txt', '.csv',
  '.zip', '.rar',
]);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const hash = crypto.randomBytes(16).toString('hex');
    cb(null, `${hash}${ext}`);
  }
});

function fileFilter(_req: Request, file: Express.Multer.File, cb: FileFilterCallback) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIMES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`Tipo de arquivo não permitido: ${file.mimetype || ext}`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 }
});

const router = Router();

export async function cleanupOrphanedFiles(): Promise<void> {
  try {
    const deletedAttachments = await all<{ file_path: string }>(
      "SELECT file_path FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '7 days'"
    );
    for (const att of deletedAttachments) {
      const filePath = path.join(UPLOAD_DIR, path.basename(att.file_path));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    if (deletedAttachments.length > 0) {
      await run("DELETE FROM attachments WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '7 days'");
      logger.info('Cleanup completed', { removed_files: deletedAttachments.length });
    }
  } catch (err) {
    logger.warn('Upload cleanup error (non-critical)', { error: err instanceof Error ? err.message : err });
  }
}

setInterval(cleanupOrphanedFiles, ORPHAN_CLEANUP_INTERVAL);
cleanupOrphanedFiles();

// ✅ CORREÇÃO: Função de validação de path
function validateFilePath(filePath: string): string | null {
  const resolvedPath = path.resolve(UPLOAD_DIR, filePath);
  const resolvedUploadDir = path.resolve(UPLOAD_DIR);
  if (!resolvedPath.startsWith(resolvedUploadDir + path.sep) && resolvedPath !== resolvedUploadDir) {
    return null;
  }
  return resolvedPath;
}

router.post('/demands/:id/attachments', authenticateToken, requirePermission('demands.edit'), (req: Request, res: Response) => {
  upload.array('files', 10)(req, res, async (err) => {
    if (err) {
      // Em caso de erro do multer, o próprio multer remove os arquivos que já
      // haviam sido gravados nesta requisição.
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Arquivo muito grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Máximo de 10 arquivos por upload' });
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message });
    }

    const files = (req.files as Express.Multer.File[]) || [];
    // O multer grava todos os arquivos no disco antes de invocar este callback.
    // Se qualquer etapa posterior falhar, removemos exatamente os arquivos desta
    // requisição (e os registros já inseridos por ela), garantindo atomicidade
    // sem jamais tocar em arquivos/registros válidos de outras requisições.
    const writtenPaths = files.map((f) => f.path);
    const insertedIds: number[] = [];

    const rollbackUpload = async () => {
      for (const p of writtenPaths) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (unlinkErr) {
          logger.warn('Falha ao remover arquivo de upload abortado', { error: unlinkErr instanceof Error ? unlinkErr.message : unlinkErr });
        }
      }
      if (insertedIds.length > 0) {
        try {
          await run('DELETE FROM attachments WHERE id = ANY($1::int[])', [insertedIds]);
        } catch (deleteErr) {
          logger.warn('Falha ao remover registros de anexo do upload abortado', { error: deleteErr instanceof Error ? deleteErr.message : deleteErr });
        }
      }
    };

    try {
      const { ip_address, user_agent } = extractMeta(req);
      const demand = await get('SELECT id, title FROM demands WHERE id = $1 AND deleted_at IS NULL', [req.params.id as string]);
      if (!demand) {
        await rollbackUpload();
        return res.status(404).json({ error: 'Demanda não encontrada' });
      }
      if (files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

      const saved: Attachment[] = [];

      for (const file of files) {
        const fileBuffer = fs.readFileSync(file.path);
        const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const result = await run(
          `INSERT INTO attachments (demand_id, name, size, type, file_path, uploaded_by, mime_type, file_size, file_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [req.params.id as string, file.originalname, `${sizeMB} MB`, file.mimetype, file.filename,
           req.user!.id, file.mimetype, file.size, fileHash]
        );
        insertedIds.push(result.rows[0].id);
        saved.push(result.rows[0]);
      }

      await addTimelineEvent(req.params.id as string, 'Arquivos Anexados',
        `${files.length} arquivo(s) anexado(s) por ${req.user!.name}`, req.user!.name, undefined, 'attachment',
        { file_count: files.length, file_names: files.map(f => f.originalname) });

      await logAudit({
        entity_type: 'demand', entity_id: req.params.id as string, action: 'upload',
        user_id: req.user!.id, user_name: req.user!.name,
        details: { file_count: files.length, file_names: files.map(f => f.originalname) },
        ip_address, user_agent
      });

      res.status(201).json(saved);
    } catch (error) {
      await rollbackUpload();
      logger.error('Upload error:', error);
      res.status(500).json({ error: 'Erro ao fazer upload' });
    }
  });
});

router.get('/attachments/:id', authenticateToken, requirePermission('demands.view'), async (req: Request, res: Response) => {
  try {
    const attachment = await get('SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL', [parseInt(req.params.id as string)]);
    if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado' });

    // ✅ CORREÇÃO: Path traversal validation
    const safePath = validateFilePath(attachment.file_path!);
    if (!safePath) {
      return res.status(403).json({ error: 'Acesso negado ao arquivo' });
    }
    if (!fs.existsSync(safePath)) return res.status(404).json({ error: 'Arquivo não encontrado no disco' });

    const mime = attachment.mime_type || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    const safeFilename = (attachment.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const isInlineImage = mime.startsWith('image/') && mime !== 'image/svg+xml';
    res.setHeader('Content-Disposition', isInlineImage ? `inline; filename="${safeFilename}"` : `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', attachment.file_size || 0);
    res.sendFile(safePath);
  } catch (error) {
    logger.error('Download error:', error);
    res.status(500).json({ error: 'Erro ao baixar arquivo' });
  }
});

router.delete('/attachments/:id', authenticateToken, requirePermission('demands.edit'), async (req: Request, res: Response) => {
  try {
    const { ip_address, user_agent } = extractMeta(req);
    const attachment = await get('SELECT * FROM attachments WHERE id = $1 AND deleted_at IS NULL', [parseInt(req.params.id as string)]);
    if (!attachment) return res.status(404).json({ error: 'Anexo não encontrado' });

    const filePath = path.join(UPLOAD_DIR, path.basename(attachment.file_path));
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    await run('DELETE FROM attachments WHERE id = $1', [attachment.id]);
    await logAudit({
      entity_type: 'demand', entity_id: attachment.demand_id, action: 'attachment_delete',
      user_id: req.user!.id, user_name: req.user!.name,
      details: { file_name: attachment.name }, ip_address, user_agent
    });

    res.json({ message: 'Anexo removido com sucesso' });
  } catch (error) {
    logger.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Erro ao remover anexo' });
  }
});

export default router;
