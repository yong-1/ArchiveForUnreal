import { Prisma, PrismaClient } from '@prisma/client';
const globalDb = globalThis as unknown as { archiveDb?: PrismaClient };
export const db = globalDb.archiveDb ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalDb.archiveDb = db;
export type Transaction = Prisma.TransactionClient;
export type Database = PrismaClient | Transaction;
export async function lock(tx: Transaction, table: 'archive_items'|'storage_objects'|'upload_batches'|'upload_sessions'|'delete_requests'|'jobs', id: string) {
  await tx.$queryRawUnsafe('SELECT id FROM "' + table + '" WHERE id = $1::uuid FOR UPDATE', id);
}
export async function serial<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.$transaction(fn, { maxWait: 15_000, timeout: 30_000 });
}
export function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v));
}
