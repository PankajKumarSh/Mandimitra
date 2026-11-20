-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('HI', 'EN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "BusinessStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "TradingMode" AS ENUM ('COMMISSION_AGENT', 'TRADER', 'MIXED');

-- CreateEnum
CREATE TYPE "NetRounding" AS ENUM ('NONE', 'NEAREST_RUPEE');

-- CreateEnum
CREATE TYPE "PattiLanguage" AS ENUM ('HI', 'EN', 'BILINGUAL');

-- CreateEnum
CREATE TYPE "QuantityUnit" AS ENUM ('KG', 'QUINTAL', 'TON', 'BAG');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_SOLD', 'SOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TxnStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PattiStatus" AS ENUM ('DRAFT', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('COMMISSION', 'LABOUR', 'WEIGHING', 'TRANSPORT', 'MARKET_FEE', 'LOADING_UNLOADING', 'OTHER');

-- CreateEnum
CREATE TYPE "CalcMethod" AS ENUM ('PERCENTAGE', 'FIXED', 'PER_QUINTAL', 'PER_KG', 'PER_BAG');

-- CreateEnum
CREATE TYPE "PartySide" AS ENUM ('FARMER', 'BUYER');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING_BALANCE', 'PATTI_CREDIT', 'SALE_DEBIT', 'ADVANCE', 'PAYMENT', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentDirection" AS ENUM ('OUTGOING', 'INCOMING');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('ADVANCE', 'SETTLEMENT', 'COLLECTION', 'REFUND', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('FARMER', 'BUYER', 'LOT', 'PURCHASE', 'SALE', 'PATTI', 'PAYMENT', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('CANCEL', 'EDIT', 'LEDGER_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'CANCEL', 'CONFIRM', 'FINALIZE', 'APPROVE', 'REJECT', 'RESTORE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REUSE_DETECTED', 'PASSWORD_CHANGED', 'BUSINESS_SWITCHED', 'REPORT_EXPORTED', 'STATEMENT_SHARED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BillingPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('PATTI_PDF', 'STATEMENT_PDF', 'RECEIPT_PDF', 'EXPENSE_BILL', 'AI_UPLOAD', 'LOGO', 'EXPORT');

-- CreateEnum
CREATE TYPE "AiRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');

-- CreateEnum
CREATE TYPE "AiInputMode" AS ENUM ('TEXT', 'VOICE', 'IMAGE');

-- CreateEnum
CREATE TYPE "AiDraftType" AS ENUM ('FARMER', 'LOT', 'PURCHASE', 'SALE', 'PAYMENT', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AiDraftStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISCARDED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "email" VARCHAR(254),
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "preferredLanguage" "Language" NOT NULL DEFAULT 'HI',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "businessId" UUID,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" UUID,
    "userAgent" VARCHAR(300),
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "nameHindi" VARCHAR(150),
    "ownerUserId" UUID NOT NULL,
    "mandiName" VARCHAR(150),
    "licenseNumber" VARCHAR(60),
    "gstin" VARCHAR(15),
    "phone" VARCHAR(15),
    "email" VARCHAR(254),
    "addressLine" VARCHAR(300),
    "city" VARCHAR(80),
    "district" VARCHAR(80),
    "state" VARCHAR(80),
    "pincode" VARCHAR(6),
    "logoId" UUID,
    "status" "BusinessStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspendedAt" TIMESTAMPTZ(3),
    "suspendReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessSettings" (
    "businessId" UUID NOT NULL,
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'COMMISSION_AGENT',
    "defaultRateUnit" "QuantityUnit" NOT NULL DEFAULT 'QUINTAL',
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 4,
    "netRounding" "NetRounding" NOT NULL DEFAULT 'NEAREST_RUPEE',
    "pattiLanguage" "PattiLanguage" NOT NULL DEFAULT 'BILINGUAL',
    "pattiFooterNote" VARCHAR(500),
    "requireApprovalForCancel" BOOLEAN NOT NULL DEFAULT true,
    "allowNegativeFarmerBalance" BOOLEAN NOT NULL DEFAULT true,
    "autoAdjustAdvanceInPatti" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessSettings_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "businessId" UUID,
    "key" VARCHAR(50) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameHindi" VARCHAR(80),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "module" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200) NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "BusinessMembership" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3),
    "deactivatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "mobile" VARCHAR(15) NOT NULL,
    "fullName" VARCHAR(120),
    "roleId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farmer" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "nameHindi" VARCHAR(120),
    "fatherName" VARCHAR(120),
    "mobile" VARCHAR(15),
    "village" VARCHAR(100),
    "tehsil" VARCHAR(100),
    "district" VARCHAR(100),
    "state" VARCHAR(80),
    "address" VARCHAR(300),
    "notes" TEXT,
    "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "whatsappConsent" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "whatsappConsentAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmerBankAccount" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "farmerId" UUID NOT NULL,
    "accountHolderName" VARCHAR(120) NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountNumberLast4" VARCHAR(4) NOT NULL,
    "ifsc" VARCHAR(11),
    "bankName" VARCHAR(120),
    "upiId" VARCHAR(100),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FarmerBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Buyer" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "firmName" VARCHAR(150) NOT NULL,
    "ownerName" VARCHAR(120),
    "mobile" VARCHAR(15),
    "address" VARCHAR(300),
    "city" VARCHAR(100),
    "gstin" VARCHAR(15),
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currentBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditLimit" DECIMAL(14,2),
    "notes" TEXT,
    "whatsappConsent" "ConsentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "whatsappConsentAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Buyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commodity" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameHindi" VARCHAR(80),
    "defaultUnit" "QuantityUnit" NOT NULL DEFAULT 'QUINTAL',
    "rateUnit" "QuantityUnit" NOT NULL DEFAULT 'QUINTAL',
    "bagWeightKg" DECIMAL(8,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Commodity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommodityGrade" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "commodityId" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommodityGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lot" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "lotNumber" VARCHAR(30) NOT NULL,
    "farmerId" UUID NOT NULL,
    "commodityId" UUID NOT NULL,
    "gradeId" UUID,
    "arrivalDate" DATE NOT NULL,
    "vehicleNumber" VARCHAR(20),
    "bags" INTEGER NOT NULL DEFAULT 0,
    "grossWeightKg" DECIMAL(14,3) NOT NULL,
    "tareWeightKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "netWeightKg" DECIMAL(14,3) NOT NULL,
    "moisturePercent" DECIMAL(5,2),
    "soldWeightKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "purchasedWeightKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "status" "LotStatus" NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,
    "confirmedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "purchaseNumber" VARCHAR(30) NOT NULL,
    "farmerId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "commodityId" UUID NOT NULL,
    "saleId" UUID,
    "pattiId" UUID,
    "purchaseDate" DATE NOT NULL,
    "weightKg" DECIMAL(14,3) NOT NULL,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2) NOT NULL,
    "rateUnit" "QuantityUnit" NOT NULL DEFAULT 'QUINTAL',
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "status" "TxnStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "saleNumber" VARCHAR(30) NOT NULL,
    "buyerId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "commodityId" UUID NOT NULL,
    "saleDate" DATE NOT NULL,
    "weightKg" DECIMAL(14,3) NOT NULL,
    "bags" INTEGER NOT NULL DEFAULT 0,
    "rate" DECIMAL(12,2) NOT NULL,
    "rateUnit" "QuantityUnit" NOT NULL DEFAULT 'QUINTAL',
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "chargesTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "status" "TxnStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleCharge" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "commissionRuleId" UUID,
    "chargeType" "ChargeType" NOT NULL,
    "calcMethod" "CalcMethod" NOT NULL,
    "rateValue" DECIMAL(12,4) NOT NULL,
    "baseValue" DECIMAL(16,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SaleCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameHindi" VARCHAR(80),
    "chargeType" "ChargeType" NOT NULL,
    "calcMethod" "CalcMethod" NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "appliesTo" "PartySide" NOT NULL DEFAULT 'FARMER',
    "commodityId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patti" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "pattiNumber" VARCHAR(30) NOT NULL,
    "farmerId" UUID NOT NULL,
    "pattiDate" DATE NOT NULL,
    "status" "PattiStatus" NOT NULL DEFAULT 'DRAFT',
    "totalWeightKg" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "totalBags" INTEGER NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDeductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advanceAdjusted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "roundOff" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "netPayable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "farmerSnapshot" JSONB,
    "businessSnapshot" JSONB,
    "notes" TEXT,
    "finalizedAt" TIMESTAMPTZ(3),
    "finalizedById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "pdfId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Patti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "pattiId" UUID NOT NULL,
    "commissionRuleId" UUID,
    "chargeType" "ChargeType" NOT NULL,
    "calcMethod" "CalcMethod" NOT NULL,
    "rateValue" DECIMAL(12,4) NOT NULL,
    "baseValue" DECIMAL(16,3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "labelHindi" VARCHAR(80),
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmerLedgerEntry" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "businessId" UUID NOT NULL,
    "farmerId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "narration" VARCHAR(300) NOT NULL,
    "pattiId" UUID,
    "paymentId" UUID,
    "reversalOfId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLedgerEntry" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "businessId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "entryDate" DATE NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "narration" VARCHAR(300) NOT NULL,
    "saleId" UUID,
    "paymentId" UUID,
    "reversalOfId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "receiptNumber" VARCHAR(30) NOT NULL,
    "partySide" "PartySide" NOT NULL,
    "farmerId" UUID,
    "buyerId" UUID,
    "direction" "PaymentDirection" NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "referenceNumber" VARCHAR(60),
    "amount" DECIMAL(14,2) NOT NULL,
    "paymentDate" DATE NOT NULL,
    "remarks" VARCHAR(300),
    "idempotencyKey" VARCHAR(64) NOT NULL,
    "status" "TxnStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "receiptPdfId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameHindi" VARCHAR(80),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "expenseNumber" VARCHAR(30) NOT NULL,
    "categoryId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL DEFAULT 'CASH',
    "payee" VARCHAR(120),
    "referenceNumber" VARCHAR(60),
    "remarks" VARCHAR(300),
    "billId" UUID,
    "status" "TxnStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "businessId" UUID NOT NULL,
    "docType" "DocType" NOT NULL,
    "fiscalYear" VARCHAR(7) NOT NULL,
    "prefix" VARCHAR(10) NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("businessId","docType","fiscalYear")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(200) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "payload" JSONB,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" UUID NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "businessId" UUID,
    "actorUserId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" VARCHAR(64),
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffActivity" (
    "id" UUID NOT NULL,
    "businessId" UUID,
    "userId" UUID,
    "activityType" "ActivityType" NOT NULL,
    "metadata" JSONB,
    "ipAddress" VARCHAR(45),
    "userAgent" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "nameHindi" VARCHAR(60),
    "priceMonthly" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "trialDays" INTEGER NOT NULL DEFAULT 14,
    "maxStaffUsers" INTEGER,
    "maxFarmers" INTEGER,
    "maxMonthlyAiQueries" INTEGER NOT NULL DEFAULT 0,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "exportsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMPTZ(3),
    "currentPeriodStart" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "pendingPlanId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "eventType" VARCHAR(40) NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus",
    "fromPlanCode" VARCHAR(30),
    "toPlanCode" VARCHAR(30),
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "gateway" VARCHAR(20) NOT NULL DEFAULT 'RAZORPAY',
    "gatewayOrderId" VARCHAR(100) NOT NULL,
    "gatewayPaymentId" VARCHAR(100),
    "status" "BillingPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "verifiedAt" TIMESTAMPTZ(3),
    "periodStart" TIMESTAMPTZ(3),
    "periodEnd" TIMESTAMPTZ(3),
    "failureReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "eventId" VARCHAR(120) NOT NULL,
    "eventType" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "body" VARCHAR(500),
    "link" VARCHAR(300),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "farmerId" UUID,
    "buyerId" UUID,
    "toMobile" VARCHAR(15) NOT NULL,
    "templateName" VARCHAR(100) NOT NULL,
    "templateLanguage" VARCHAR(10) NOT NULL DEFAULT 'hi',
    "variables" JSONB NOT NULL,
    "mediaId" UUID,
    "relatedEntityType" VARCHAR(40),
    "relatedEntityId" UUID,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" VARCHAR(120),
    "errorCode" VARCHAR(40),
    "errorMessage" VARCHAR(300),
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "purpose" "AttachmentPurpose" NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" VARCHAR(150),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "AiRole" NOT NULL,
    "inputMode" "AiInputMode" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "attachmentId" UUID,
    "toolCalls" JSONB,
    "model" VARCHAR(60),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" UUID NOT NULL,
    "businessId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID,
    "messageId" UUID,
    "draftType" "AiDraftType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "AiDraftStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedEntityType" VARCHAR(40),
    "confirmedEntityId" UUID,
    "confirmedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_mobile_key" ON "User"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "Business_status_idx" ON "Business"("status");

-- CreateIndex
CREATE INDEX "Business_ownerUserId_idx" ON "Business"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_businessId_key_key" ON "Role"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMembership_businessId_userId_key" ON "BusinessMembership"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvite_businessId_mobile_idx" ON "StaffInvite"("businessId", "mobile");

-- CreateIndex
CREATE INDEX "Farmer_businessId_name_idx" ON "Farmer"("businessId", "name");

-- CreateIndex
CREATE INDEX "Farmer_businessId_mobile_idx" ON "Farmer"("businessId", "mobile");

-- CreateIndex
CREATE INDEX "Farmer_businessId_village_idx" ON "Farmer"("businessId", "village");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_businessId_id_key" ON "Farmer"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_businessId_code_key" ON "Farmer"("businessId", "code");

-- CreateIndex
CREATE INDEX "FarmerBankAccount_businessId_farmerId_idx" ON "FarmerBankAccount"("businessId", "farmerId");

-- CreateIndex
CREATE INDEX "Buyer_businessId_firmName_idx" ON "Buyer"("businessId", "firmName");

-- CreateIndex
CREATE INDEX "Buyer_businessId_mobile_idx" ON "Buyer"("businessId", "mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_businessId_id_key" ON "Buyer"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Buyer_businessId_code_key" ON "Buyer"("businessId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_businessId_id_key" ON "Commodity"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Commodity_businessId_name_key" ON "Commodity"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CommodityGrade_commodityId_name_key" ON "CommodityGrade"("commodityId", "name");

-- CreateIndex
CREATE INDEX "Lot_businessId_arrivalDate_idx" ON "Lot"("businessId", "arrivalDate");

-- CreateIndex
CREATE INDEX "Lot_businessId_status_idx" ON "Lot"("businessId", "status");

-- CreateIndex
CREATE INDEX "Lot_businessId_farmerId_idx" ON "Lot"("businessId", "farmerId");

-- CreateIndex
CREATE INDEX "Lot_businessId_commodityId_arrivalDate_idx" ON "Lot"("businessId", "commodityId", "arrivalDate");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_businessId_id_key" ON "Lot"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Lot_businessId_lotNumber_key" ON "Lot"("businessId", "lotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_saleId_key" ON "Purchase"("saleId");

-- CreateIndex
CREATE INDEX "Purchase_businessId_purchaseDate_idx" ON "Purchase"("businessId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Purchase_businessId_farmerId_status_idx" ON "Purchase"("businessId", "farmerId", "status");

-- CreateIndex
CREATE INDEX "Purchase_businessId_lotId_idx" ON "Purchase"("businessId", "lotId");

-- CreateIndex
CREATE INDEX "Purchase_pattiId_idx" ON "Purchase"("pattiId");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_businessId_purchaseNumber_key" ON "Purchase"("businessId", "purchaseNumber");

-- CreateIndex
CREATE INDEX "Sale_businessId_saleDate_idx" ON "Sale"("businessId", "saleDate");

-- CreateIndex
CREATE INDEX "Sale_businessId_buyerId_status_idx" ON "Sale"("businessId", "buyerId", "status");

-- CreateIndex
CREATE INDEX "Sale_businessId_lotId_idx" ON "Sale"("businessId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_id_key" ON "Sale"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_businessId_saleNumber_key" ON "Sale"("businessId", "saleNumber");

-- CreateIndex
CREATE INDEX "SaleCharge_businessId_saleId_idx" ON "SaleCharge"("businessId", "saleId");

-- CreateIndex
CREATE INDEX "CommissionRule_businessId_isActive_appliesTo_idx" ON "CommissionRule"("businessId", "isActive", "appliesTo");

-- CreateIndex
CREATE INDEX "CommissionRule_businessId_commodityId_idx" ON "CommissionRule"("businessId", "commodityId");

-- CreateIndex
CREATE INDEX "Patti_businessId_pattiDate_idx" ON "Patti"("businessId", "pattiDate");

-- CreateIndex
CREATE INDEX "Patti_businessId_farmerId_status_idx" ON "Patti"("businessId", "farmerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Patti_businessId_id_key" ON "Patti"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Patti_businessId_pattiNumber_key" ON "Patti"("businessId", "pattiNumber");

-- CreateIndex
CREATE INDEX "Deduction_businessId_pattiId_idx" ON "Deduction"("businessId", "pattiId");

-- CreateIndex
CREATE UNIQUE INDEX "FarmerLedgerEntry_reversalOfId_key" ON "FarmerLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "FarmerLedgerEntry_businessId_farmerId_seq_idx" ON "FarmerLedgerEntry"("businessId", "farmerId", "seq");

-- CreateIndex
CREATE INDEX "FarmerLedgerEntry_businessId_entryDate_idx" ON "FarmerLedgerEntry"("businessId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLedgerEntry_reversalOfId_key" ON "BuyerLedgerEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "BuyerLedgerEntry_businessId_buyerId_seq_idx" ON "BuyerLedgerEntry"("businessId", "buyerId", "seq");

-- CreateIndex
CREATE INDEX "BuyerLedgerEntry_businessId_entryDate_idx" ON "BuyerLedgerEntry"("businessId", "entryDate");

-- CreateIndex
CREATE INDEX "Payment_businessId_paymentDate_idx" ON "Payment"("businessId", "paymentDate");

-- CreateIndex
CREATE INDEX "Payment_businessId_farmerId_idx" ON "Payment"("businessId", "farmerId");

-- CreateIndex
CREATE INDEX "Payment_businessId_buyerId_idx" ON "Payment"("businessId", "buyerId");

-- CreateIndex
CREATE INDEX "Payment_businessId_mode_referenceNumber_idx" ON "Payment"("businessId", "mode", "referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_businessId_receiptNumber_key" ON "Payment"("businessId", "receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_businessId_idempotencyKey_key" ON "Payment"("businessId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_businessId_id_key" ON "ExpenseCategory"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_businessId_name_key" ON "ExpenseCategory"("businessId", "name");

-- CreateIndex
CREATE INDEX "Expense_businessId_expenseDate_idx" ON "Expense"("businessId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_businessId_categoryId_expenseDate_idx" ON "Expense"("businessId", "categoryId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_businessId_expenseNumber_key" ON "Expense"("businessId", "expenseNumber");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_businessId_key_key" ON "IdempotencyRecord"("businessId", "key");

-- CreateIndex
CREATE INDEX "ApprovalRequest_businessId_status_idx" ON "ApprovalRequest"("businessId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_businessId_entityType_entityId_idx" ON "ApprovalRequest"("businessId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_entityType_entityId_idx" ON "AuditLog"("businessId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_createdAt_idx" ON "AuditLog"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffActivity_businessId_createdAt_idx" ON "StaffActivity"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffActivity_userId_createdAt_idx" ON "StaffActivity"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_businessId_key" ON "Subscription"("businessId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_businessId_createdAt_idx" ON "SubscriptionEvent"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_gatewayOrderId_key" ON "BillingPayment"("gatewayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_gatewayPaymentId_key" ON "BillingPayment"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "BillingPayment_businessId_createdAt_idx" ON "BillingPayment"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "Notification_userId_businessId_readAt_idx" ON "Notification"("userId", "businessId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_providerMessageId_key" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_businessId_createdAt_idx" ON "WhatsAppMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_businessId_status_idx" ON "WhatsAppMessage"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_businessId_purpose_idx" ON "Attachment"("businessId", "purpose");

-- CreateIndex
CREATE INDEX "AiConversation_businessId_userId_updatedAt_idx" ON "AiConversation"("businessId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiMessage_businessId_createdAt_idx" ON "AiMessage"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AiDraft_businessId_userId_status_idx" ON "AiDraft"("businessId", "userId", "status");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessMembership" ADD CONSTRAINT "BusinessMembership_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerBankAccount" ADD CONSTRAINT "FarmerBankAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerBankAccount" ADD CONSTRAINT "FarmerBankAccount_businessId_farmerId_fkey" FOREIGN KEY ("businessId", "farmerId") REFERENCES "Farmer"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commodity" ADD CONSTRAINT "Commodity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommodityGrade" ADD CONSTRAINT "CommodityGrade_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommodityGrade" ADD CONSTRAINT "CommodityGrade_businessId_commodityId_fkey" FOREIGN KEY ("businessId", "commodityId") REFERENCES "Commodity"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_businessId_farmerId_fkey" FOREIGN KEY ("businessId", "farmerId") REFERENCES "Farmer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_businessId_commodityId_fkey" FOREIGN KEY ("businessId", "commodityId") REFERENCES "Commodity"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "CommodityGrade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lot" ADD CONSTRAINT "Lot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_farmerId_fkey" FOREIGN KEY ("businessId", "farmerId") REFERENCES "Farmer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_lotId_fkey" FOREIGN KEY ("businessId", "lotId") REFERENCES "Lot"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_businessId_commodityId_fkey" FOREIGN KEY ("businessId", "commodityId") REFERENCES "Commodity"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_pattiId_fkey" FOREIGN KEY ("pattiId") REFERENCES "Patti"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_buyerId_fkey" FOREIGN KEY ("businessId", "buyerId") REFERENCES "Buyer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_lotId_fkey" FOREIGN KEY ("businessId", "lotId") REFERENCES "Lot"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_businessId_commodityId_fkey" FOREIGN KEY ("businessId", "commodityId") REFERENCES "Commodity"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCharge" ADD CONSTRAINT "SaleCharge_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCharge" ADD CONSTRAINT "SaleCharge_businessId_saleId_fkey" FOREIGN KEY ("businessId", "saleId") REFERENCES "Sale"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleCharge" ADD CONSTRAINT "SaleCharge_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_commodityId_fkey" FOREIGN KEY ("commodityId") REFERENCES "Commodity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patti" ADD CONSTRAINT "Patti_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patti" ADD CONSTRAINT "Patti_businessId_farmerId_fkey" FOREIGN KEY ("businessId", "farmerId") REFERENCES "Farmer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patti" ADD CONSTRAINT "Patti_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patti" ADD CONSTRAINT "Patti_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patti" ADD CONSTRAINT "Patti_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_businessId_pattiId_fkey" FOREIGN KEY ("businessId", "pattiId") REFERENCES "Patti"("businessId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_commissionRuleId_fkey" FOREIGN KEY ("commissionRuleId") REFERENCES "CommissionRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_businessId_farmerId_fkey" FOREIGN KEY ("businessId", "farmerId") REFERENCES "Farmer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_pattiId_fkey" FOREIGN KEY ("pattiId") REFERENCES "Patti"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "FarmerLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmerLedgerEntry" ADD CONSTRAINT "FarmerLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_businessId_buyerId_fkey" FOREIGN KEY ("businessId", "buyerId") REFERENCES "Buyer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "BuyerLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLedgerEntry" ADD CONSTRAINT "BuyerLedgerEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receiptPdfId_fkey" FOREIGN KEY ("receiptPdfId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_businessId_categoryId_fkey" FOREIGN KEY ("businessId", "categoryId") REFERENCES "ExpenseCategory"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffActivity" ADD CONSTRAINT "StaffActivity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffActivity" ADD CONSTRAINT "StaffActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingPayment" ADD CONSTRAINT "BillingPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written integrity constraints (not expressible in Prisma schema).
-- These are the last line of defence; the service layer validates first.
-- =============================================================================

-- Lots: weights must be coherent and stock can never go negative.
ALTER TABLE "Lot"
  ADD CONSTRAINT "Lot_gross_positive"      CHECK ("grossWeightKg" > 0),
  ADD CONSTRAINT "Lot_tare_valid"          CHECK ("tareWeightKg" >= 0 AND "tareWeightKg" < "grossWeightKg"),
  ADD CONSTRAINT "Lot_net_equals"          CHECK ("netWeightKg" = "grossWeightKg" - "tareWeightKg"),
  ADD CONSTRAINT "Lot_sold_within_net"     CHECK ("soldWeightKg" >= 0 AND "soldWeightKg" <= "netWeightKg"),
  ADD CONSTRAINT "Lot_purchased_within_net" CHECK ("purchasedWeightKg" >= 0 AND "purchasedWeightKg" <= "netWeightKg"),
  ADD CONSTRAINT "Lot_bags_nonneg"         CHECK ("bags" >= 0),
  ADD CONSTRAINT "Lot_moisture_range"      CHECK ("moisturePercent" IS NULL OR ("moisturePercent" >= 0 AND "moisturePercent" <= 100));

-- Purchases / sales: no zero or negative quantities or rates.
ALTER TABLE "Purchase"
  ADD CONSTRAINT "Purchase_weight_positive" CHECK ("weightKg" > 0),
  ADD CONSTRAINT "Purchase_rate_positive"   CHECK ("rate" > 0),
  ADD CONSTRAINT "Purchase_gross_nonneg"    CHECK ("grossAmount" >= 0),
  ADD CONSTRAINT "Purchase_bags_nonneg"     CHECK ("bags" >= 0);

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_weight_positive" CHECK ("weightKg" > 0),
  ADD CONSTRAINT "Sale_rate_positive"   CHECK ("rate" > 0),
  ADD CONSTRAINT "Sale_amounts_valid"   CHECK ("grossAmount" >= 0 AND "chargesTotal" >= 0
                                               AND "totalAmount" = "grossAmount" + "chargesTotal"),
  ADD CONSTRAINT "Sale_bags_nonneg"     CHECK ("bags" >= 0);

ALTER TABLE "SaleCharge" ADD CONSTRAINT "SaleCharge_amount_nonneg" CHECK ("amount" >= 0);
ALTER TABLE "Deduction"  ADD CONSTRAINT "Deduction_amount_nonneg"  CHECK ("amount" >= 0);

-- Patti: deductions can never exceed gross ("excessive deductions" edge case).
ALTER TABLE "Patti"
  ADD CONSTRAINT "Patti_amounts_nonneg"   CHECK ("grossAmount" >= 0 AND "totalDeductions" >= 0 AND "advanceAdjusted" >= 0),
  ADD CONSTRAINT "Patti_deductions_le_gross" CHECK ("totalDeductions" <= "grossAmount"),
  ADD CONSTRAINT "Patti_net_equals"       CHECK ("netAmount" = "grossAmount" - "totalDeductions"),
  ADD CONSTRAINT "Patti_payable_equals"   CHECK ("netPayable" = "netAmount" - "advanceAdjusted" + "roundOff"),
  ADD CONSTRAINT "Patti_advance_le_net"   CHECK ("advanceAdjusted" <= "netAmount");

-- Commission rules: sane values.
ALTER TABLE "CommissionRule"
  ADD CONSTRAINT "CommissionRule_value_nonneg" CHECK ("value" >= 0),
  ADD CONSTRAINT "CommissionRule_pct_max"      CHECK ("calcMethod" <> 'PERCENTAGE' OR "value" <= 100),
  ADD CONSTRAINT "CommissionRule_dates"        CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");

-- Ledgers: each entry is exactly one-sided and positive.
ALTER TABLE "FarmerLedgerEntry"
  ADD CONSTRAINT "FarmerLedger_one_sided" CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0));
ALTER TABLE "BuyerLedgerEntry"
  ADD CONSTRAINT "BuyerLedger_one_sided"  CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0));

-- Payments: positive amount; exactly one party matching partySide and direction.
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Payment_party_valid" CHECK (
        ("partySide" = 'FARMER' AND "farmerId" IS NOT NULL AND "buyerId" IS NULL)
     OR ("partySide" = 'BUYER'  AND "buyerId"  IS NOT NULL AND "farmerId" IS NULL)
  );

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_positive" CHECK ("amount" > 0);

-- Misc.
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_next_positive" CHECK ("nextValue" >= 1);
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_fy_month" CHECK ("fiscalYearStartMonth" BETWEEN 1 AND 12);
ALTER TABLE "SubscriptionPlan" ADD CONSTRAINT "SubscriptionPlan_price_nonneg" CHECK ("priceMonthly" >= 0);

-- At most one primary bank account per farmer.
CREATE UNIQUE INDEX "FarmerBankAccount_one_primary"
  ON "FarmerBankAccount"("farmerId") WHERE "isPrimary" = true;

-- Fast "active only" lookups used by available-stock and outstanding queries.
CREATE INDEX "Sale_active_lot_idx"     ON "Sale"("lotId")     WHERE "status" = 'ACTIVE';
CREATE INDEX "Purchase_active_lot_idx" ON "Purchase"("lotId") WHERE "status" = 'ACTIVE';
