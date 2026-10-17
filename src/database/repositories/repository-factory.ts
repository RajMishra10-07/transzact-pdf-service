import { env } from '../../config/env.js';
import {
  IDocumentRepository,
  PgDocumentRepository,
  InMemoryDocumentRepository,
} from './document-repository.js';
import {
  IBulkJobRepository,
  PgBulkJobRepository,
  InMemoryBulkJobRepository,
} from './bulk-job-repository.js';
import {
  IDocumentAuditRepository,
  PgDocumentAuditRepository,
  InMemoryDocumentAuditRepository,
} from './audit-repository.js';
import {
  IUserRepository,
  PgUserRepository,
  InMemoryUserRepository,
} from './user-repository.js';

let documentRepoInstance: IDocumentRepository | null = null;
let bulkJobRepoInstance: IBulkJobRepository | null = null;
let auditRepoInstance: IDocumentAuditRepository | null = null;
let userRepoInstance: IUserRepository | null = null;

let forceInMemoryMode = false;

export function setForceInMemoryRepositories(enable: boolean): void {
  forceInMemoryMode = enable;
  documentRepoInstance = enable ? new InMemoryDocumentRepository() : null;
  bulkJobRepoInstance = enable ? new InMemoryBulkJobRepository() : null;
  auditRepoInstance = enable ? new InMemoryDocumentAuditRepository() : null;
  userRepoInstance = enable ? new InMemoryUserRepository() : null;
}

export function getDocumentRepository(): IDocumentRepository {
  if (!documentRepoInstance) {
    documentRepoInstance =
      forceInMemoryMode || env.NODE_ENV === 'test' || env.USE_IN_MEMORY_FALLBACK
        ? new InMemoryDocumentRepository()
        : new PgDocumentRepository();
  }
  return documentRepoInstance;
}

export function getBulkJobRepository(): IBulkJobRepository {
  if (!bulkJobRepoInstance) {
    bulkJobRepoInstance =
      forceInMemoryMode || env.NODE_ENV === 'test' || env.USE_IN_MEMORY_FALLBACK
        ? new InMemoryBulkJobRepository()
        : new PgBulkJobRepository();
  }
  return bulkJobRepoInstance;
}

export function getAuditRepository(): IDocumentAuditRepository {
  if (!auditRepoInstance) {
    auditRepoInstance =
      forceInMemoryMode || env.NODE_ENV === 'test' || env.USE_IN_MEMORY_FALLBACK
        ? new InMemoryDocumentAuditRepository()
        : new PgDocumentAuditRepository();
  }
  return auditRepoInstance;
}

export function getUserRepository(): IUserRepository {
  if (!userRepoInstance) {
    userRepoInstance =
      forceInMemoryMode || env.NODE_ENV === 'test' || env.USE_IN_MEMORY_FALLBACK
        ? new InMemoryUserRepository()
        : new PgUserRepository();
  }
  return userRepoInstance;
}
