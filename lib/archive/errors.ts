export class ArchiveError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function check(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new ArchiveError(status, code, message);
}
