declare module 'connect-pg-simple' {
  import session from 'express-session';

  interface PGStoreOptions {
    conString?: string;
    pool?: unknown;
    tableName?: string;
    createTableIfMissing?: boolean;
    ttl?: number;
    pruneSessionInterval?: number | false;
  }

  function connectPgSimple(s: typeof session): {
    new (options?: PGStoreOptions): session.Store;
  };

  export = connectPgSimple;
}
