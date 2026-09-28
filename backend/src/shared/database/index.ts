/** Capa de persistencia: conexión, unidad de trabajo, migraciones y sonda. */
export {
  closeConnection,
  getConnection,
  isConnectionOpen,
  setConnectionForTests,
  type Db,
} from './connection.js';

export {
  assertInTransaction,
  inTransaction,
  runInTransaction,
  runInTransactionSync,
  transactionDepth,
  translateSqliteError,
} from './unit-of-work.js';

export {
  MIGRATIONS_TABLE,
  assertHistoryIntegrity,
  checksumOf,
  countPending,
  ensureMigrationsTable,
  listApplied,
  readMigrations,
  resolveMigrationsDir,
  rollback,
  up,
  type AppliedMigration,
  type MigrationFile,
  type MigrationStatus,
  type RollbackResult,
  type UpResult,
} from './migrator.js';

export { checkDatabaseHealth, pingDatabase, type CheckStatus, type DatabaseHealth } from './health.js';

export {
  findActiveBusiness,
  findUserAuthByEmail,
  findUserAuthById,
  findUserPermissions,
  findUserRoles,
  hasSchema,
  type BusinessSettingsRow,
  type UserAuthRow,
  type UserRoleName,
} from './queries.js';
