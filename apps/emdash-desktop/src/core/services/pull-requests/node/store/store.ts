import {
  defineDerivedSqliteStore,
  nodeSqliteDriver,
} from '@emdash/core/primitives/sqlite-store/node';
import { schemaFingerprint, schemaSqlStatements } from './schema-sql.generated';

export const pullRequestSqliteStore = defineDerivedSqliteStore({
  name: 'pull-requests',
  driver: nodeSqliteDriver,
  version: schemaFingerprint,
  createSchema(connection) {
    for (const statement of schemaSqlStatements) connection.exec(statement);
  },
});
