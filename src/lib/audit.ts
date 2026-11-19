import { db, newId } from './store'
import type { Profile } from './types'

export function logAudit(actor: Profile | undefined, action: string, entity: string, detail: string, companyId?: string) {
  db.auditLogs.insert({
    id: newId(),
    companyId: companyId ?? actor?.companyId,
    actorId: actor?.id ?? 'system',
    actorEmail: actor?.email ?? 'system',
    action,
    entity,
    detail,
    createdAt: Date.now(),
  })
}
