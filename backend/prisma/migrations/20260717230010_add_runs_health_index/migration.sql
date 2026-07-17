-- CreateIndex
CREATE INDEX "runs_tenantId_createdAt_status_idx" ON "runs"("tenantId", "createdAt", "status");
