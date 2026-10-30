DROP INDEX "one_active_job";
CREATE UNIQUE INDEX "one_active_job" ON "jobs" ("type","targetId","actorId") WHERE "state" IN ('QUEUED','RUNNING','WAITING');
