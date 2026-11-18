CREATE TYPE "public"."credential_category" AS ENUM('IDENTITY', 'QUALIFICATION', 'MEMBERSHIP', 'AUTHORIZATION', 'EVENT', 'EXPERIENCE');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('DRAFT', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."revocation_reason" AS ENUM('ISSUER_ERROR', 'HOLDER_REQUEST', 'RELATIONSHIP_ENDED', 'SUPERSEDED', 'FRAUD', 'EXPIRED_EARLY');--> statement-breakpoint
CREATE TYPE "public"."verification_outcome" AS ENUM('VERIFIED', 'PENDING', 'EXPIRED', 'REVOKED', 'INVALID', 'NOT_FOUND');--> statement-breakpoint
CREATE TABLE "credential_revocations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"credential_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"reason" "revocation_reason" NOT NULL,
	"note" varchar(240),
	"revoked_by_user_id" char(26),
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_types" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" "credential_category" NOT NULL,
	"description" text,
	"claim_schema" text[] NOT NULL,
	"default_validity_days" integer,
	"disclose_holder_name" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"public_ref" varchar(40) NOT NULL,
	"credential_type_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"holder_user_id" char(26),
	"holder_external_ref" varchar(120),
	"holder_name_snapshot" varchar(160) NOT NULL,
	"status" "credential_status" DEFAULT 'ACTIVE' NOT NULL,
	"claims" jsonb NOT NULL,
	"claims_hash" "bytea" NOT NULL,
	"issuer_signature" "bytea" NOT NULL,
	"issuer_key_id" varchar(16) DEFAULT 'v1' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"issued_by_user_id" char(26),
	"supersedes_id" char(26),
	"verification_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"credential_id" char(26),
	"presented_ref" varchar(64) NOT NULL,
	"outcome" "verification_outcome" NOT NULL,
	"verifier_organization_id" char(26),
	"verifier_user_id" char(26),
	"api_key_id" char(26),
	"channel" varchar(24) NOT NULL,
	"request_id" varchar(40),
	"ip_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signing_public_key" "bytea";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signing_private_cipher" "bytea";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "signing_key_id" varchar(16) DEFAULT 'v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "credential_revocations" ADD CONSTRAINT "credential_revocations_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_revocations" ADD CONSTRAINT "credential_revocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_types" ADD CONSTRAINT "credential_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_credential_type_id_credential_types_id_fk" FOREIGN KEY ("credential_type_id") REFERENCES "public"."credential_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifier_organization_id_organizations_id_fk" FOREIGN KEY ("verifier_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verifier_user_id_users_id_fk" FOREIGN KEY ("verifier_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_revocations_credential_key" ON "credential_revocations" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "credential_revocations_org_idx" ON "credential_revocations" USING btree ("organization_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_types_org_key" ON "credential_types" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "credential_types_org_idx" ON "credential_types" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "credentials_public_ref_key" ON "credentials" USING btree ("public_ref");--> statement-breakpoint
CREATE INDEX "credentials_org_created_idx" ON "credentials" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "credentials_holder_idx" ON "credentials" USING btree ("holder_user_id","status");--> statement-breakpoint
CREATE INDEX "credentials_type_idx" ON "credentials" USING btree ("credential_type_id","status");--> statement-breakpoint
CREATE INDEX "credentials_expiry_idx" ON "credentials" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "verifications_credential_idx" ON "verifications" USING btree ("credential_id","created_at");--> statement-breakpoint
CREATE INDEX "verifications_outcome_idx" ON "verifications" USING btree ("outcome","created_at");--> statement-breakpoint
CREATE INDEX "verifications_verifier_idx" ON "verifications" USING btree ("verifier_organization_id","created_at");--> statement-breakpoint
CREATE INDEX "verifications_created_idx" ON "verifications" USING btree ("created_at");