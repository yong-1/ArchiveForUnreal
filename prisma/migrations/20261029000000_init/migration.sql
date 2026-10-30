-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image" TEXT,
    "emailVerified" TIMESTAMPTZ(6),
    "hashedPassword" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(6) NOT NULL
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'VIEWER',
    "canDownload" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_projects" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_access" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "canDownload" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "project_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keywords" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_items" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "roles" TEXT[],
    "title" TEXT NOT NULL,
    "broadcastTitle" TEXT NOT NULL DEFAULT '',
    "broadcastYear" SMALLINT,
    "categoryId" UUID,
    "description" TEXT NOT NULL DEFAULT '',
    "currentVersionId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "nextVersionNo" BIGINT NOT NULL DEFAULT 1,
    "lifecycle" TEXT NOT NULL DEFAULT 'ACTIVE',
    "managedIndependently" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "archive_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_keywords" (
    "teamId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "keywordId" UUID NOT NULL,

    CONSTRAINT "item_keywords_pkey" PRIMARY KEY ("itemId","keywordId")
);

-- CreateTable
CREATE TABLE "item_facilities" (
    "teamId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "facilityId" UUID NOT NULL,

    CONSTRAINT "item_facilities_pkey" PRIMARY KEY ("itemId","facilityId")
);

-- CreateTable
CREATE TABLE "item_responsibles" (
    "teamId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "item_responsibles_pkey" PRIMARY KEY ("itemId","userId")
);

-- CreateTable
CREATE TABLE "item_versions" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "versionNo" BIGINT,
    "baseVersionId" UUID,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "technicalMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_links" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "fromVersionId" UUID NOT NULL,
    "toVersionId" UUID NOT NULL,
    "relation" TEXT NOT NULL DEFAULT 'ASSOCIATED',
    "evidence" TEXT NOT NULL DEFAULT '',
    "confirmedBy" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "item_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memos" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_metadata_revisions" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_metadata_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_roots" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ONLINE',

    CONSTRAINT "storage_roots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "rootId" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_versions" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "itemVersionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "manifestObjectId" UUID,
    "manifestHash" TEXT,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'PREPARING',
    "verifiedAt" TIMESTAMPTZ(6),

    CONSTRAINT "archive_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_files" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "archiveVersionId" UUID NOT NULL,
    "relativePath" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "archive_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_leases" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "file_leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archive_plans" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "batchId" UUID,
    "baseVersionId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "policyVersion" TEXT NOT NULL DEFAULT 'ue-cache-only-v1',
    "hash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'REVIEW',
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "archive_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entries" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "relativePath" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "resolution" TEXT,
    "sourceMtime" TEXT,

    CONSTRAINT "plan_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_batches" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestKey" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'UPLOADING',
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "upload_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "relativePath" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "mime" TEXT NOT NULL,
    "checksum" TEXT,
    "state" TEXT NOT NULL DEFAULT 'UPLOADING',
    "objectId" UUID,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_parts" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "partNo" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "upload_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unreal_archive_profiles" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "uprojectPath" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL DEFAULT '',
    "environment" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "validationStatus" TEXT NOT NULL DEFAULT 'NOT_TESTED',

    CONSTRAINT "unreal_archive_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preview_derivatives" (
    "id" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "objectId" UUID,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "preview_derivatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'QUEUED',
    "input" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMPTZ(6),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delete_requests" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "requestKey" TEXT,
    "scope" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PLANNED',
    "startedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delete_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delete_entries" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "purgedAt" TIMESTAMPTZ(6),

    CONSTRAINT "delete_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_validations" (
    "id" UUID NOT NULL,
    "archiveId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "environment" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'NOT_TESTED',
    "report" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restore_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "userId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("userId","itemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_teamId_userId_key" ON "memberships"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_teamId_id_key" ON "memberships"("teamId", "id");

-- CreateIndex
CREATE INDEX "production_projects_teamId_createdAt_idx" ON "production_projects"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_projects_teamId_id_key" ON "production_projects"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_access_projectId_membershipId_key" ON "project_access"("projectId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_teamId_name_key" ON "categories"("teamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_teamId_id_key" ON "categories"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_teamId_name_key" ON "facilities"("teamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_teamId_id_key" ON "facilities"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_teamId_name_key" ON "keywords"("teamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "keywords_teamId_id_key" ON "keywords"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "archive_items_currentVersionId_key" ON "archive_items"("currentVersionId");

-- CreateIndex
CREATE INDEX "archive_items_teamId_kind_broadcastYear_id_idx" ON "archive_items"("teamId", "kind", "broadcastYear" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "archive_items_projectId_lifecycle_idx" ON "archive_items"("projectId", "lifecycle");

-- CreateIndex
CREATE UNIQUE INDEX "archive_items_id_currentVersionId_key" ON "archive_items"("id", "currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "archive_items_teamId_id_key" ON "archive_items"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_versions_itemId_id_key" ON "item_versions"("itemId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_versions_teamId_id_key" ON "item_versions"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_versions_itemId_versionNo_key" ON "item_versions"("itemId", "versionNo");

-- CreateIndex
CREATE INDEX "item_links_toVersionId_active_idx" ON "item_links"("toVersionId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "item_links_fromVersionId_toVersionId_key" ON "item_links"("fromVersionId", "toVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "item_metadata_revisions_itemId_revision_key" ON "item_metadata_revisions"("itemId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "storage_roots_teamId_id_key" ON "storage_roots"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "storage_roots_teamId_name_key" ON "storage_roots"("teamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_rootId_objectKey_key" ON "storage_objects"("rootId", "objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_teamId_id_key" ON "storage_objects"("teamId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "archive_versions_itemVersionId_key" ON "archive_versions"("itemVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "archive_versions_teamId_itemVersionId_key" ON "archive_versions"("teamId", "itemVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "archive_versions_teamId_id_key" ON "archive_versions"("teamId", "id");

-- CreateIndex
CREATE INDEX "archive_files_storageObjectId_active_idx" ON "archive_files"("storageObjectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "archive_files_archiveVersionId_canonicalPath_key" ON "archive_files"("archiveVersionId", "canonicalPath");

-- CreateIndex
CREATE INDEX "file_leases_objectId_expiresAt_idx" ON "file_leases"("objectId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entries_planId_canonicalPath_key" ON "plan_entries"("planId", "canonicalPath");

-- CreateIndex
CREATE UNIQUE INDEX "upload_batches_teamId_actorId_requestKey_key" ON "upload_batches"("teamId", "actorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_batchId_itemId_canonicalPath_key" ON "upload_sessions"("batchId", "itemId", "canonicalPath");

-- CreateIndex
CREATE UNIQUE INDEX "upload_parts_sessionId_partNo_key" ON "upload_parts"("sessionId", "partNo");

-- CreateIndex
CREATE UNIQUE INDEX "unreal_archive_profiles_versionId_key" ON "unreal_archive_profiles"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "preview_derivatives_versionId_type_key" ON "preview_derivatives"("versionId", "type");

-- CreateIndex
CREATE INDEX "jobs_state_type_createdAt_idx" ON "jobs"("state", "type", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_teamId_createdAt_idx" ON "audit_events"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "delete_requests_teamId_actorId_requestKey_key" ON "delete_requests"("teamId", "actorId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "delete_entries_requestId_objectId_key" ON "delete_entries"("requestId", "objectId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_teamId_projectId_fkey" FOREIGN KEY ("teamId", "projectId") REFERENCES "production_projects"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_access" ADD CONSTRAINT "project_access_teamId_membershipId_fkey" FOREIGN KEY ("teamId", "membershipId") REFERENCES "memberships"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_items" ADD CONSTRAINT "archive_items_teamId_projectId_fkey" FOREIGN KEY ("teamId", "projectId") REFERENCES "production_projects"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_items" ADD CONSTRAINT "archive_items_teamId_categoryId_fkey" FOREIGN KEY ("teamId", "categoryId") REFERENCES "categories"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_items" ADD CONSTRAINT "archive_items_id_currentVersionId_fkey" FOREIGN KEY ("id", "currentVersionId") REFERENCES "item_versions"("itemId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_keywords" ADD CONSTRAINT "item_keywords_teamId_itemId_fkey" FOREIGN KEY ("teamId", "itemId") REFERENCES "archive_items"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_keywords" ADD CONSTRAINT "item_keywords_teamId_keywordId_fkey" FOREIGN KEY ("teamId", "keywordId") REFERENCES "keywords"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_facilities" ADD CONSTRAINT "item_facilities_teamId_itemId_fkey" FOREIGN KEY ("teamId", "itemId") REFERENCES "archive_items"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_facilities" ADD CONSTRAINT "item_facilities_teamId_facilityId_fkey" FOREIGN KEY ("teamId", "facilityId") REFERENCES "facilities"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_responsibles" ADD CONSTRAINT "item_responsibles_teamId_itemId_fkey" FOREIGN KEY ("teamId", "itemId") REFERENCES "archive_items"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_responsibles" ADD CONSTRAINT "item_responsibles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_versions" ADD CONSTRAINT "item_versions_teamId_itemId_fkey" FOREIGN KEY ("teamId", "itemId") REFERENCES "archive_items"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_versions" ADD CONSTRAINT "item_versions_itemId_baseVersionId_fkey" FOREIGN KEY ("itemId", "baseVersionId") REFERENCES "item_versions"("itemId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_teamId_fromVersionId_fkey" FOREIGN KEY ("teamId", "fromVersionId") REFERENCES "item_versions"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_links" ADD CONSTRAINT "item_links_teamId_toVersionId_fkey" FOREIGN KEY ("teamId", "toVersionId") REFERENCES "item_versions"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memos" ADD CONSTRAINT "memos_teamId_versionId_fkey" FOREIGN KEY ("teamId", "versionId") REFERENCES "item_versions"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_metadata_revisions" ADD CONSTRAINT "item_metadata_revisions_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "archive_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_roots" ADD CONSTRAINT "storage_roots_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storage_objects" ADD CONSTRAINT "storage_objects_teamId_rootId_fkey" FOREIGN KEY ("teamId", "rootId") REFERENCES "storage_roots"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_versions" ADD CONSTRAINT "archive_versions_teamId_itemVersionId_fkey" FOREIGN KEY ("teamId", "itemVersionId") REFERENCES "item_versions"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_versions" ADD CONSTRAINT "archive_versions_teamId_manifestObjectId_fkey" FOREIGN KEY ("teamId", "manifestObjectId") REFERENCES "storage_objects"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_teamId_archiveVersionId_fkey" FOREIGN KEY ("teamId", "archiveVersionId") REFERENCES "archive_versions"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archive_files" ADD CONSTRAINT "archive_files_teamId_storageObjectId_fkey" FOREIGN KEY ("teamId", "storageObjectId") REFERENCES "storage_objects"("teamId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_leases" ADD CONSTRAINT "file_leases_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entries" ADD CONSTRAINT "plan_entries_planId_fkey" FOREIGN KEY ("planId") REFERENCES "archive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "upload_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "upload_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unreal_archive_profiles" ADD CONSTRAINT "unreal_archive_profiles_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "item_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_derivatives" ADD CONSTRAINT "preview_derivatives_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "item_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preview_derivatives" ADD CONSTRAINT "preview_derivatives_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delete_entries" ADD CONSTRAINT "delete_entries_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "delete_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_validations" ADD CONSTRAINT "restore_validations_archiveId_fkey" FOREIGN KEY ("archiveId") REFERENCES "archive_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "archive_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
