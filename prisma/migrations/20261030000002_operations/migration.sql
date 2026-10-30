-- v6.1 AR-17/AR-18: 작업 진행 이력, 보존 객체 무결성 재검사 시각, 저장소 상태 점검 시각
CREATE TABLE "job_events" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_event_kind" CHECK ("kind" IN ('STARTED','PROGRESS','WAITING','COMPLETED','FAILED','CANCELLED','LEASE_LOST','NOTE')),
    CONSTRAINT "job_event_data" CHECK (jsonb_typeof("data")='object' AND octet_length("data"::text) <= 65536)
);
CREATE INDEX "job_events_jobId_createdAt_idx" ON "job_events"("jobId","createdAt");
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "storage_objects" ADD COLUMN "verifiedAt" TIMESTAMPTZ(6);
CREATE INDEX "storage_objects_teamId_state_verifiedAt_idx" ON "storage_objects"("teamId","state","verifiedAt");
ALTER TABLE "storage_roots" ADD COLUMN "checkedAt" TIMESTAMPTZ(6);
CREATE INDEX "upload_batches_state_expiresAt_idx" ON "upload_batches"("state","expiresAt");
