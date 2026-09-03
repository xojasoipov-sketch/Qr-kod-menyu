import { Pool, types, type PoolClient } from 'pg';

// bigint (OID 20) va numeric (OID 1700) ustunlarini JS number sifatida qaytaramiz — bu
// dastur pul miqdorlarini "number" deb hisoblaydi va ular UZS chegarasida xavfsiz son.
types.setTypeParser(20, (val) => parseInt(val, 10));
types.setTypeParser(1700, (val) => parseFloat(val));
// timestamptz'ni ISO 8601 satr sifatida qaytaramiz — dastur created_at/updated_at ni
// har doim string deb kutadi (Date obyekti emas).
types.setTypeParser(1114, (val) => new Date(val + 'Z').toISOString());
types.setTypeParser(1184, (val) => new Date(val).toISOString());

const globalForPg = globalThis as unknown as { __pgPool?: Pool };

/**
 * LAZY: pool faqat birinchi so'rovda yaratiladi — import yoki build vaqtida ULANISHGA
 * urinilmasin (build muhitida DATABASE_URL bo'lmasligi yoki tarmoq yo'qligi build'ni
 * buzmasligi kerak).
 */
export function getPool(): Pool {
  if (globalForPg.__pgPool) return globalForPg.__pgPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL sozlanmagan. Bazaga ulanish uchun bu muhit o'zgaruvchisi kerak."
    );
  }
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => {
    console.error('[pg] Kutilmagan pool xatosi:', err);
  });
  globalForPg.__pgPool = pool;
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await getPool().query(text, params as unknown[]);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

/** Bir nechta yozuvni bitta tranzaksiyada bajarish uchun (masalan createOrder). */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
