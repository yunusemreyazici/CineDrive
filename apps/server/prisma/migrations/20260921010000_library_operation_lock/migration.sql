ALTER TABLE "Library" ADD COLUMN "operationLockKind" TEXT;
ALTER TABLE "Library" ADD COLUMN "operationLockToken" TEXT;
ALTER TABLE "Library" ADD COLUMN "operationLockExpiresAt" DATETIME;

CREATE INDEX "Library_operationLockExpiresAt_idx" ON "Library"("operationLockExpiresAt");
