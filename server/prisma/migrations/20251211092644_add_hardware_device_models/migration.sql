-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "modelId" TEXT;

-- CreateTable
CREATE TABLE "hardware_device_models" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "connectivity" TEXT[],
    "secureElement" BOOLEAN NOT NULL DEFAULT false,
    "openSource" BOOLEAN NOT NULL DEFAULT false,
    "airGapped" BOOLEAN NOT NULL DEFAULT false,
    "supportsBitcoinOnly" BOOLEAN NOT NULL DEFAULT true,
    "supportsMultisig" BOOLEAN NOT NULL DEFAULT true,
    "supportsTaproot" BOOLEAN NOT NULL DEFAULT false,
    "supportsPassphrase" BOOLEAN NOT NULL DEFAULT true,
    "scriptTypes" TEXT[],
    "hasScreen" BOOLEAN NOT NULL DEFAULT true,
    "screenType" TEXT,
    "releaseYear" INTEGER,
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hardware_device_models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hardware_device_models_name_key" ON "hardware_device_models"("name");

-- CreateIndex
CREATE UNIQUE INDEX "hardware_device_models_slug_key" ON "hardware_device_models"("slug");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "hardware_device_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;
