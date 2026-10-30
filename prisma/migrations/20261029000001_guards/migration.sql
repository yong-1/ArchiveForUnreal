ALTER TABLE "memberships" ADD CONSTRAINT "membership_role" CHECK ("role" IN ('ADMIN','EDITOR','VIEWER'));
ALTER TABLE "archive_items" ADD CONSTRAINT "item_kind" CHECK ("kind" IN ('VIDEO','IMAGE','MODEL3D','FILE','UNREAL_PROJECT'));
ALTER TABLE "archive_items" ADD CONSTRAINT "item_roles" CHECK (cardinality("roles") > 0 AND "roles" <@ ARRAY['RESULT','SOURCE','REFERENCE']::text[]);
ALTER TABLE "archive_items" ADD CONSTRAINT "item_lifecycle" CHECK ("lifecycle" IN ('ACTIVE','DELETE_PENDING','DELETED'));
ALTER TABLE "item_versions" ADD CONSTRAINT "positive_version" CHECK ("versionNo" IS NULL OR "versionNo" > 0);
ALTER TABLE "archive_files" ADD CONSTRAINT "file_size" CHECK ("sizeBytes" >= 0);
ALTER TABLE "storage_objects" ADD CONSTRAINT "object_size" CHECK ("sizeBytes" >= 0);
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_size" CHECK ("sizeBytes" >= 0);
ALTER TABLE "upload_parts" ADD CONSTRAINT "part_size" CHECK ("sizeBytes" BETWEEN 0 AND 8388608 AND "partNo" >= 0);
ALTER TABLE "item_versions" ADD CONSTRAINT "metadata_object" CHECK (jsonb_typeof("technicalMetadata") = 'object' AND octet_length("technicalMetadata"::text) <= 65536);
ALTER TABLE "storage_objects" ADD CONSTRAINT "available_checksum" CHECK ("state" <> 'AVAILABLE' OR "checksum" ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX "one_active_job" ON "jobs" ("type","targetId") WHERE "state" IN ('QUEUED','RUNNING','WAITING');
CREATE INDEX "metadata_gin" ON "item_versions" USING GIN ("technicalMetadata");

CREATE FUNCTION archive_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."currentVersionId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "item_versions" v JOIN "archive_versions" a ON a."itemVersionId"=v.id
  WHERE v.id=NEW."currentVersionId" AND v."itemId"=NEW.id AND v.state='READY' AND a.state='VERIFIED' AND NEW.lifecycle='ACTIVE'
 ) THEN RAISE EXCEPTION 'representative requires verified same-item active version'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "current_version_guard" BEFORE INSERT OR UPDATE ON "archive_items" FOR EACH ROW EXECUTE FUNCTION archive_current_guard();

CREATE FUNCTION archive_object_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state <> 'STAGING' AND (NEW."teamId",NEW."rootId",NEW."objectKey",NEW."sizeBytes",NEW.checksum)
 IS DISTINCT FROM (OLD."teamId",OLD."rootId",OLD."objectKey",OLD."sizeBytes",OLD.checksum)
 THEN RAISE EXCEPTION 'immutable object payload'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "object_payload_guard" BEFORE UPDATE ON "storage_objects" FOR EACH ROW EXECUTE FUNCTION archive_object_guard();

CREATE FUNCTION archive_file_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text; item_state text;
BEGIN
 SELECT a.state,i.lifecycle INTO parent_state,item_state FROM "archive_versions" a
 JOIN "item_versions" v ON v.id=a."itemVersionId" JOIN "archive_items" i ON i.id=v."itemId"
 WHERE a.id=OLD."archiveVersionId";
 IF parent_state IN ('VERIFIED','DELETE_PENDING','DELETED') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'preserved file rows require explicit lifecycle operation'; END IF;
  IF (NEW."archiveVersionId",NEW."relativePath",NEW."canonicalPath",NEW."storageObjectId",NEW."sizeBytes",NEW.checksum,NEW.mime)
   IS DISTINCT FROM (OLD."archiveVersionId",OLD."relativePath",OLD."canonicalPath",OLD."storageObjectId",OLD."sizeBytes",OLD.checksum,OLD.mime)
   THEN RAISE EXCEPTION 'immutable archive file payload'; END IF;
  IF NEW.active IS DISTINCT FROM OLD.active AND item_state <> 'DELETE_PENDING' THEN RAISE EXCEPTION 'file reference change requires confirmed deletion'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "file_payload_guard" BEFORE UPDATE OR DELETE ON "archive_files" FOR EACH ROW EXECUTE FUNCTION archive_file_guard();

CREATE FUNCTION archive_manifest_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state IN ('VERIFIED','DELETE_PENDING','DELETED') AND
 (NEW."itemVersionId",NEW."planId",NEW."manifestObjectId",NEW."manifestHash",NEW."fileCount",NEW."totalBytes")
 IS DISTINCT FROM (OLD."itemVersionId",OLD."planId",OLD."manifestObjectId",OLD."manifestHash",OLD."fileCount",OLD."totalBytes")
 THEN RAISE EXCEPTION 'immutable archive manifest'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "manifest_payload_guard" BEFORE UPDATE ON "archive_versions" FOR EACH ROW EXECUTE FUNCTION archive_manifest_guard();

CREATE FUNCTION archive_link_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_state text; item_state text;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT state INTO version_state FROM "item_versions" WHERE id=NEW."fromVersionId";
  IF version_state <> 'DRAFT' THEN RAISE EXCEPTION 'add source links in a new draft version'; END IF;
  RETURN NEW;
 END IF;
 SELECT v.state,i.lifecycle INTO version_state,item_state FROM "item_versions" v JOIN "archive_items" i ON i.id=v."itemId" WHERE v.id=OLD."fromVersionId";
 IF version_state IN ('READY','DELETE_PENDING','DELETED') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'preserve historical links'; END IF;
  IF (NEW."fromVersionId",NEW."toVersionId",NEW.relation,NEW.evidence) IS DISTINCT FROM (OLD."fromVersionId",OLD."toVersionId",OLD.relation,OLD.evidence)
   THEN RAISE EXCEPTION 'immutable version source link'; END IF;
  IF NEW.active IS DISTINCT FROM OLD.active AND item_state <> 'DELETE_PENDING' THEN RAISE EXCEPTION 'link change requires confirmed deletion'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "source_link_guard" BEFORE INSERT OR UPDATE OR DELETE ON "item_links" FOR EACH ROW EXECUTE FUNCTION archive_link_guard();
