CREATE TABLE "SystemMetricSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" TEXT NOT NULL DEFAULT 'host',
    "cpuPercent" REAL,
    "memoryUsedBytes" BIGINT,
    "memoryTotalBytes" BIGINT,
    "diskUsedBytes" BIGINT,
    "diskTotalBytes" BIGINT,
    "diskReadBytesPerSecond" REAL,
    "diskWriteBytesPerSecond" REAL,
    "diskReadBytesTotal" BIGINT,
    "diskWriteBytesTotal" BIGINT,
    "networkReceiveBytesPerSecond" REAL,
    "networkTransmitBytesPerSecond" REAL,
    "networkReceiveBytesDelta" BIGINT NOT NULL DEFAULT 0,
    "networkTransmitBytesDelta" BIGINT NOT NULL DEFAULT 0,
    "networkReceiveBytesTotal" BIGINT,
    "networkTransmitBytesTotal" BIGINT,
    "networkInterface" TEXT,
    "temperatureCelsius" REAL
);

CREATE INDEX "SystemMetricSample_recordedAt_idx" ON "SystemMetricSample"("recordedAt");
