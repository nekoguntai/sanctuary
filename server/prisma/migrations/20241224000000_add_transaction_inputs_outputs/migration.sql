-- CreateTable
CREATE TABLE "transaction_inputs" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "inputIndex" INTEGER NOT NULL,
    "txid" TEXT NOT NULL,
    "vout" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "derivationPath" TEXT,

    CONSTRAINT "transaction_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_outputs" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "outputIndex" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "scriptPubKey" TEXT,
    "outputType" TEXT NOT NULL DEFAULT 'unknown',
    "isOurs" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,

    CONSTRAINT "transaction_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transaction_inputs_transactionId_inputIndex_key" ON "transaction_inputs"("transactionId", "inputIndex");

-- CreateIndex
CREATE INDEX "transaction_inputs_transactionId_idx" ON "transaction_inputs"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_inputs_address_idx" ON "transaction_inputs"("address");

-- CreateIndex
CREATE INDEX "transaction_inputs_txid_vout_idx" ON "transaction_inputs"("txid", "vout");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_outputs_transactionId_outputIndex_key" ON "transaction_outputs"("transactionId", "outputIndex");

-- CreateIndex
CREATE INDEX "transaction_outputs_transactionId_idx" ON "transaction_outputs"("transactionId");

-- CreateIndex
CREATE INDEX "transaction_outputs_address_idx" ON "transaction_outputs"("address");

-- CreateIndex
CREATE INDEX "transaction_outputs_outputType_idx" ON "transaction_outputs"("outputType");

-- CreateIndex
CREATE INDEX "transaction_outputs_isOurs_idx" ON "transaction_outputs"("isOurs");

-- AddForeignKey
ALTER TABLE "transaction_inputs" ADD CONSTRAINT "transaction_inputs_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_outputs" ADD CONSTRAINT "transaction_outputs_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
