/*
  Warnings:

  - The `status` column on the `inquiries` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[sender_id,property_id]` on the table `inquiries` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('PENDING', 'READ', 'RESPONDED', 'CLOSED', 'SPAM');

-- DropIndex
DROP INDEX "inquiries_property_id_idx";

-- DropIndex
DROP INDEX "inquiries_sender_id_idx";

-- DropIndex
DROP INDEX "properties_is_active_idx";

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "spam_score" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "status",
ADD COLUMN     "status" "InquiryStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "idx_inquiries_property_inbox" ON "inquiries"("property_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_inquiries_sent_box" ON "inquiries"("sender_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_inquiries_owner_inbox" ON "inquiries"("receiver_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_inquiries_duplicate_check" ON "inquiries"("sender_id", "property_id", "last_sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_sender_id_property_id_key" ON "inquiries"("sender_id", "property_id");

-- CreateIndex
CREATE INDEX "idx_properties_locality" ON "properties"("locality");

-- CreateIndex
CREATE INDEX "idx_properties_bedrooms" ON "properties"("bedrooms");

-- CreateIndex
CREATE INDEX "idx_properties_feed" ON "properties"("is_active", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_properties_search" ON "properties"("city", "property_type", "listing_type", "is_active");

-- CreateIndex
CREATE INDEX "idx_properties_price_range" ON "properties"("is_active", "price", "listing_type");

-- CreateIndex
CREATE INDEX "idx_properties_bedrooms_city" ON "properties"("city", "bedrooms", "is_active");

-- CreateIndex
CREATE INDEX "idx_properties_owner_active" ON "properties"("owner_id", "is_active", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_property_images_primary" ON "property_images"("property_id", "is_primary");

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "properties_city_idx" RENAME TO "idx_properties_city";

-- RenameIndex
ALTER INDEX "properties_created_at_idx" RENAME TO "idx_properties_created_at";

-- RenameIndex
ALTER INDEX "properties_owner_id_idx" RENAME TO "idx_properties_owner_id";

-- RenameIndex
ALTER INDEX "properties_price_idx" RENAME TO "idx_properties_price";

-- RenameIndex
ALTER INDEX "property_images_property_id_idx" RENAME TO "idx_property_images_property_id";
