import type { Pool, PoolClient } from 'pg';

/** Anything that can run a query: a pool or a checked-out client. */
export type Db = Pick<Pool | PoolClient, 'query'>;
