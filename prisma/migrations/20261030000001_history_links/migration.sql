-- v6.1 AR-04/AR-14: 소스 실사용 확인 시각, 버전별 설명과 수정 이력, 메모 수정 이력
ALTER TABLE "item_links" ADD COLUMN "confirmedAt" TIMESTAMPTZ(6);
ALTER TABLE "item_links" ADD CONSTRAINT "link_confirmed_at" CHECK ("relation" <> 'USED_CONFIRMED' OR "confirmedAt" IS NOT NULL);

ALTER TABLE "item_versions" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "item_versions" ADD COLUMN "descriptionRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "item_versions" ADD CONSTRAINT "version_description_size" CHECK (char_length("description") <= 20000 AND "descriptionRevision" > 0);

CREATE TABLE "version_description_revisions" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "version_description_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "version_description_revisions_versionId_revision_key" ON "version_description_revisions"("versionId","revision");
ALTER TABLE "version_description_revisions" ADD CONSTRAINT "version_description_revisions_teamId_versionId_fkey" FOREIGN KEY ("teamId","versionId") REFERENCES "item_versions"("teamId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "version_description_revisions" ADD CONSTRAINT "version_description_revisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "memos" ADD COLUMN "updatedAt" TIMESTAMPTZ(6);
CREATE INDEX "memos_versionId_createdAt_idx" ON "memos"("versionId","createdAt");
CREATE TABLE "memo_revisions" (
    "id" UUID NOT NULL,
    "memoId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memo_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memo_revisions_memoId_revision_key" ON "memo_revisions"("memoId","revision");
ALTER TABLE "memo_revisions" ADD CONSTRAINT "memo_revisions_memoId_fkey" FOREIGN KEY ("memoId") REFERENCES "memos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "memo_revisions" ADD CONSTRAINT "memo_revisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
