import { z } from 'zod';
export const uuid = z.string().uuid();
export const kind = z.enum(['VIDEO','IMAGE','MODEL3D','FILE','UNREAL_PROJECT']);
export const metadataInput = z.object({
  projectId: uuid, title: z.string().trim().min(1).max(200),
  kind, roles: z.array(z.enum(['RESULT','SOURCE','REFERENCE'])).min(1).max(3),
  broadcastTitle: z.string().max(200).default(''), broadcastYear: z.number().int().min(1900).max(2200).nullable().default(null),
  description: z.string().max(20_000).default(''), categoryId: uuid.nullable().default(null),
  keywords: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  facilityIds: z.array(uuid).max(30).default([]), responsibleIds: z.array(uuid).max(30).default([]),
  managedIndependently: z.boolean().default(false),
});
export const fileInput = z.object({
  path: z.string().min(1).max(1024), size: z.string().regex(/^\d+$/).refine(s=>BigInt(s)<=10n*1024n**4n,'최대 파일 크기 초과'),
  mime: z.string().max(200).default('application/octet-stream'), checksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export const batchInput = z.object({
  requestKey: z.string().min(8).max(100),
  items: z.array(z.object({
    itemId:uuid, baseVersionId:uuid.nullable(), revision:z.number().int().positive(),
    files:z.array(fileInput).max(100_000),
    removePaths:z.array(z.string().max(1024)).max(100_000).default([]),
    sourceVersionIds:z.array(uuid).max(200).default([]),
    sourceItemIds:z.array(uuid).max(200).default([]),
    replaceSources:z.boolean().default(false),
    versionDescription:z.string().max(20_000).default(''),
    // 키: 연결 대상 소스 버전 ID 또는 같은 배치의 소스 항목 ID. 실사용 확인은 확인자와 근거를 함께 기록한다.
    linkDetails:z.record(z.string().uuid(),z.object({relation:z.enum(['ASSOCIATED','USED_CONFIRMED']),evidence:z.string().trim().max(2000).default('')})).default({}),
    decisions:z.record(z.string(),z.enum(['INCLUDE','EXCLUDE'])).default({}),
    unreal:z.object({engineVersion:z.string().max(80),distribution:z.enum(['LAUNCHER','CUSTOM']),build:z.string().max(200).default(''),plugins:z.array(z.object({name:z.string().max(150),version:z.string().max(80).default(''),required:z.boolean().default(true)})).max(200).default([]),notes:z.string().max(5000).default('')}).optional(),
  })).min(1).max(30),
});
export type BatchInput = z.infer<typeof batchInput>;
