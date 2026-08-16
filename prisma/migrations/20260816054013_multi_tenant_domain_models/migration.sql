-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "plan" TEXT,
    "settings" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyLocationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT,
    "productType" TEXT,
    "vendor" TEXT,
    "shopifyCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT,
    "title" TEXT,
    "price" DECIMAL,
    "shopifyCreatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "available" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryLevel_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SalesDaily_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RiskScore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "reasons" TEXT,
    "computedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RiskScore_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "cursor" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "lastSyncedAt" DATETIME,
    "error" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shop_key" ON "Shop"("shop");

-- CreateIndex
CREATE INDEX "Location_shop_idx" ON "Location"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Location_shop_shopifyLocationId_key" ON "Location"("shop", "shopifyLocationId");

-- CreateIndex
CREATE INDEX "Product_shop_idx" ON "Product"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Product_shop_shopifyProductId_key" ON "Product"("shop", "shopifyProductId");

-- CreateIndex
CREATE INDEX "Variant_shop_idx" ON "Variant"("shop");

-- CreateIndex
CREATE INDEX "Variant_productId_idx" ON "Variant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_shop_shopifyVariantId_key" ON "Variant"("shop", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "InventoryLevel_shop_idx" ON "InventoryLevel"("shop");

-- CreateIndex
CREATE INDEX "InventoryLevel_variantId_idx" ON "InventoryLevel"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLevel_shop_variantId_locationId_key" ON "InventoryLevel"("shop", "variantId", "locationId");

-- CreateIndex
CREATE INDEX "SalesDaily_shop_idx" ON "SalesDaily"("shop");

-- CreateIndex
CREATE INDEX "SalesDaily_variantId_idx" ON "SalesDaily"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDaily_shop_variantId_date_key" ON "SalesDaily"("shop", "variantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RiskScore_variantId_key" ON "RiskScore"("variantId");

-- CreateIndex
CREATE INDEX "RiskScore_shop_idx" ON "RiskScore"("shop");

-- CreateIndex
CREATE INDEX "RiskScore_shop_bucket_idx" ON "RiskScore"("shop", "bucket");

-- CreateIndex
CREATE INDEX "WebhookEvent_shop_idx" ON "WebhookEvent"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_topic_eventId_key" ON "WebhookEvent"("topic", "eventId");

-- CreateIndex
CREATE INDEX "SyncState_shop_idx" ON "SyncState"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SyncState_shop_resource_key" ON "SyncState"("shop", "resource");
