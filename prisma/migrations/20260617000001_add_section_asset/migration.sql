-- CreateTable
CREATE TABLE "SectionAsset" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "blobPath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SectionAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SectionAsset_sectionId_idx" ON "SectionAsset"("sectionId");

-- AddForeignKey
ALTER TABLE "SectionAsset" ADD CONSTRAINT "SectionAsset_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CourseSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
