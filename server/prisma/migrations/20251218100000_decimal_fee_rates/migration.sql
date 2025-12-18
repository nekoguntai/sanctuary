-- AlterTable: Change feeRate from INTEGER to DOUBLE PRECISION in draft_transactions
ALTER TABLE "draft_transactions" ALTER COLUMN "feeRate" TYPE DOUBLE PRECISION;

-- AlterTable: Change fee rate columns from INTEGER to DOUBLE PRECISION in fee_estimates
ALTER TABLE "fee_estimates" ALTER COLUMN "fastest" TYPE DOUBLE PRECISION;
ALTER TABLE "fee_estimates" ALTER COLUMN "halfHour" TYPE DOUBLE PRECISION;
ALTER TABLE "fee_estimates" ALTER COLUMN "hour" TYPE DOUBLE PRECISION;
