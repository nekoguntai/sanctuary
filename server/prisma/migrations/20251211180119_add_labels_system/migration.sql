-- CreateTable
CREATE TABLE "labels" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_labels" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address_labels" (
    "id" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_labels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labels_walletId_idx" ON "labels"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "labels_walletId_name_key" ON "labels"("walletId", "name");

-- CreateIndex
CREATE INDEX "transaction_labels_transactionId_idx" ON "transaction_labels"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_labels_labelId_idx" ON "transaction_labels"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_labels_transactionId_labelId_key" ON "transaction_labels"("transactionId", "labelId");

-- CreateIndex
CREATE INDEX "address_labels_addressId_idx" ON "address_labels"("addressId");

-- CreateIndex
CREATE INDEX "address_labels_labelId_idx" ON "address_labels"("labelId");

-- CreateIndex
CREATE UNIQUE INDEX "address_labels_addressId_labelId_key" ON "address_labels"("addressId", "labelId");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_labels" ADD CONSTRAINT "transaction_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_labels" ADD CONSTRAINT "address_labels_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address_labels" ADD CONSTRAINT "address_labels_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
