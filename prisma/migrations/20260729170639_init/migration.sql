/*
  Warnings:

  - The primary key for the `inquiries` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `properties` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `property_images` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `refresh_tokens` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The primary key for the `users` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - Changed the type of `id` on the `inquiries` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `property_id` on the `inquiries` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `sender_id` on the `inquiries` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `receiver_id` on the `inquiries` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `owner_id` on the `properties` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `property_images` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `property_id` on the `property_images` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `refresh_tokens` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `user_id` on the `refresh_tokens` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `id` on the `users` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_property_id_fkey";

-- DropForeignKey
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_receiver_id_fkey";

-- DropForeignKey
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_sender_id_fkey";

-- DropForeignKey
ALTER TABLE "properties" DROP CONSTRAINT "properties_owner_id_fkey";

-- DropForeignKey
ALTER TABLE "property_images" DROP CONSTRAINT "property_images_property_id_fkey";

-- DropForeignKey
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_fkey";

-- AlterTable
ALTER TABLE "inquiries" DROP CONSTRAINT "inquiries_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "property_id",
ADD COLUMN     "property_id" UUID NOT NULL,
DROP COLUMN "sender_id",
ADD COLUMN     "sender_id" UUID NOT NULL,
DROP COLUMN "receiver_id",
ADD COLUMN     "receiver_id" UUID NOT NULL,
ADD CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "properties" DROP CONSTRAINT "properties_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "owner_id",
ADD COLUMN     "owner_id" UUID NOT NULL,
ADD CONSTRAINT "properties_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "property_images" DROP CONSTRAINT "property_images_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "property_id",
ADD COLUMN     "property_id" UUID NOT NULL,
ADD CONSTRAINT "property_images_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "user_id",
ADD COLUMN     "user_id" UUID NOT NULL,
ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

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
CREATE INDEX "idx_properties_owner_id" ON "properties"("owner_id");

-- CreateIndex
CREATE INDEX "idx_properties_owner_active" ON "properties"("owner_id", "is_active", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_property_images_property_id" ON "property_images"("property_id");

-- CreateIndex
CREATE INDEX "idx_property_images_primary" ON "property_images"("property_id", "is_primary");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
