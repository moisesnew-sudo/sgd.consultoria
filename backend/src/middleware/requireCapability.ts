import { Request, Response, NextFunction } from 'express';
import {
  hasOrganizationCapability,
  type OrganizationCapability,
} from '../lib/organizationCapabilities.js';

// ETAPA 4 (AUXAMO) — Gate de capability por organizacao.
// Fonte do tenant: EXCLUSIVAMENTE req.user.tenant_id (JWT assinado, populado
// por authenticateToken, que deve rodar ANTES deste middleware na cadeia).
// NUNCA le body/query/headers/Origin/Referer para decidir tenant.
// Camada ADICIONAL ao RBAC: nao remove nenhuma checagem existente.
//   tenant valido + capability enabled -> next()
//   sem tenant autenticado valido      -> 401 (convenção existente)
//   capability ausente/desabilitada    -> 403 generico (sem internals)
// Erro de banco segue para o error handler (resposta sanitizada padrao).
export function requireCapability(capability: OrganizationCapability) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenant_id;
      if (!Number.isInteger(tenantId) || (tenantId as number) < 1) {
        return res.status(401).json({ error: 'Usuário não autenticado' });
      }
      const enabled = await hasOrganizationCapability(tenantId as number, capability);
      if (!enabled) {
        return res.status(403).json({ error: 'Recurso não disponível para esta organização.' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
