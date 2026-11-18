CREATE TYPE "public"."auth_event_kind" AS ENUM('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'SESSION_REVOKED', 'PASSWORD_CHANGED', 'OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'MFA_CHALLENGED', 'ACCOUNT_LOCKED', 'RECOVERY_STARTED', 'RECOVERY_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."connection_state" AS ENUM('ACTIVE', 'SUSPENDED', 'DISCONNECTED');--> statement-breakpoint
CREATE TYPE "public"."consent_state" AS ENUM('GRANTED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."deletion_stage" AS ENUM('REQUESTED', 'GRACE_PERIOD', 'ANONYMISING', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('SECURITY', 'TRANSACTION', 'CONSENT', 'PARTNER', 'ACCOUNT', 'PRODUCT');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('IN_APP', 'EMAIL', 'PUSH', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."organization_kind" AS ENUM('HOSPITALITY', 'RETAIL', 'ENTERTAINMENT', 'FINANCIAL_SERVICES', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('PENDING_REVIEW', 'ACTIVE', 'SUSPENDED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."pass_status" AS ENUM('ACTIVE', 'SUSPENDED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."payment_method_kind" AS ENUM('CARD', 'UPI', 'NETBANKING', 'WALLET');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('RAZORPAY', 'STRIPE', 'SANDBOX');--> statement-breakpoint
CREATE TYPE "public"."presentation_result" AS ENUM('ACCEPTED', 'REJECTED_MALFORMED', 'REJECTED_SIGNATURE', 'REJECTED_EXPIRED', 'REJECTED_REPLAY', 'REJECTED_NO_CONNECTION', 'REJECTED_PASS_INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."role_name" AS ENUM('CONSUMER', 'PARTNER_OWNER', 'PARTNER_ADMIN', 'PARTNER_STAFF', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'SECURITY_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."role_scope_kind" AS ENUM('PLATFORM', 'ORGANIZATION');--> statement-breakpoint
CREATE TYPE "public"."security_severity" AS ENUM('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETION_PENDING');--> statement-breakpoint
CREATE TYPE "public"."verification_channel" AS ENUM('EMAIL', 'SMS');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('EMAIL_VERIFY', 'MOBILE_VERIFY', 'LOGIN_OTP', 'PASSWORD_RESET', 'STEP_UP');--> statement-breakpoint
CREATE TABLE "account_deletion_requests" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"stage" "deletion_stage" DEFAULT 'REQUESTED' NOT NULL,
	"reason" varchar(240),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"execute_after" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"label" varchar(80) NOT NULL,
	"prefix" varchar(24) NOT NULL,
	"key_hash" "bytea" NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by_user_id" char(26),
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"actor_user_id" char(26),
	"actor_role" varchar(40),
	"organization_id" char(26),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(60) NOT NULL,
	"target_id" varchar(64),
	"result" varchar(24) NOT NULL,
	"request_id" varchar(40),
	"ip_hash" "bytea",
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"kind" "auth_event_kind" NOT NULL,
	"identifier_hash" "bytea",
	"ip_hash" "bytea",
	"user_agent" text,
	"request_id" varchar(40),
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_definitions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"key" varchar(64) NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"fields" text[] NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_grants" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"consent_version_id" char(26) NOT NULL,
	"connection_id" char(26),
	"state" "consent_state" DEFAULT 'GRANTED' NOT NULL,
	"purpose" varchar(200) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_versions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"definition_id" char(26) NOT NULL,
	"version" integer NOT NULL,
	"body_text" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"handle" varchar(64) NOT NULL,
	"label" varchar(120),
	"platform" varchar(40),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"scope" varchar(64) NOT NULL,
	"key" varchar(120) NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"response_code" integer,
	"response_body" jsonb,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"category" "notification_category" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"link_path" varchar(200),
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"user_id" char(26) NOT NULL,
	"status" "membership_status" DEFAULT 'INVITED' NOT NULL,
	"invited_by_user_id" char(26),
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" "organization_kind" NOT NULL,
	"status" "organization_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"legal_name" varchar(200),
	"registration_no" varchar(64),
	"city" varchar(80),
	"country_code" char(2),
	"support_email" varchar(320),
	"website_url" text,
	"connector_kind" varchar(64),
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" char(26),
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"type" varchar(64) NOT NULL,
	"aggregate_type" varchar(40) NOT NULL,
	"aggregate_id" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"channel" varchar(64) NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_connections" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"state" "connection_state" DEFAULT 'ACTIVE' NOT NULL,
	"partner_ref" varchar(40) NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pass_presentations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"pass_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"connection_id" char(26),
	"counter" integer NOT NULL,
	"result" "presentation_result" NOT NULL,
	"presented_by_user_id" char(26),
	"request_id" varchar(40),
	"ip_hash" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"pass_ref" varchar(40) NOT NULL,
	"status" "pass_status" DEFAULT 'ACTIVE' NOT NULL,
	"secret_cipher" "bytea" NOT NULL,
	"secret_key_id" varchar(16) DEFAULT 'v1' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_token" varchar(200) NOT NULL,
	"kind" "payment_method_kind" NOT NULL,
	"masked_label" varchar(64) NOT NULL,
	"network" varchar(32),
	"expiry_month" integer,
	"expiry_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"key" varchar(80) NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" char(26) NOT NULL,
	"permission_id" char(26) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"name" "role_name" NOT NULL,
	"scope" "role_scope_kind" NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"organization_id" char(26),
	"kind" varchar(64) NOT NULL,
	"severity" "security_severity" DEFAULT 'INFO' NOT NULL,
	"summary" varchar(240) NOT NULL,
	"metadata" jsonb,
	"request_id" varchar(40),
	"ip_hash" "bytea",
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"device_id" char(26),
	"ip_hash" "bytea",
	"user_agent" text,
	"elevated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(80)
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"subject" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"assigned_to_user_id" char(26),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"organization_id" char(26) NOT NULL,
	"connection_id" char(26),
	"payment_method_id" char(26),
	"amount_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"status" "transaction_status" DEFAULT 'INITIATED' NOT NULL,
	"description" varchar(200),
	"provider" "payment_provider" NOT NULL,
	"provider_order_id" varchar(120),
	"provider_payment_id" varchar(120),
	"failure_code" varchar(64),
	"idempotency_key" varchar(120),
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"captured_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"given_name" varchar(80),
	"family_name" varchar(80),
	"city" varchar(80),
	"region" varchar(80),
	"country_code" char(2),
	"locale" varchar(12) DEFAULT 'en-IN' NOT NULL,
	"avatar_url" text,
	"birth_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26) NOT NULL,
	"role_id" char(26) NOT NULL,
	"membership_id" char(26),
	"granted_by_user_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"status" "user_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"email" varchar(320),
	"email_verified_at" timestamp with time zone,
	"mobile" varchar(20),
	"mobile_verified_at" timestamp with time zone,
	"password_hash" text,
	"session_generation" integer DEFAULT 0 NOT NULL,
	"is_platform_staff" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret_cipher" "bytea",
	"last_login_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"user_id" char(26),
	"purpose" "verification_purpose" NOT NULL,
	"channel" "verification_channel" NOT NULL,
	"destination" varchar(320) NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" "bytea"
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"webhook_id" char(26) NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_code" integer,
	"error" text,
	"delivered_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"secret_cipher" "bytea" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_events" ADD CONSTRAINT "auth_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_consent_version_id_consent_versions_id_fk" FOREIGN KEY ("consent_version_id") REFERENCES "public"."consent_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_grants" ADD CONSTRAINT "consent_grants_connection_id_partner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_versions" ADD CONSTRAINT "consent_versions_definition_id_consent_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."consent_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_connections" ADD CONSTRAINT "partner_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_presentations" ADD CONSTRAINT "pass_presentations_pass_id_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."passes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_presentations" ADD CONSTRAINT "pass_presentations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_presentations" ADD CONSTRAINT "pass_presentations_connection_id_partner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_connection_id_partner_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."partner_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_method_id_payment_methods_id_fk" FOREIGN KEY ("payment_method_id") REFERENCES "public"."payment_methods"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_membership_id_organization_members_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."organization_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deletion_stage_execute_idx" ON "account_deletion_requests" USING btree ("stage","execute_after");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_key" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id","revoked_at");--> statement-breakpoint
CREATE INDEX "audit_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_events_user_created_idx" ON "auth_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_kind_created_idx" ON "auth_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "auth_events_created_idx" ON "auth_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_definitions_key_key" ON "consent_definitions" USING btree ("key");--> statement-breakpoint
CREATE INDEX "consent_grants_user_state_idx" ON "consent_grants" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "consent_grants_org_state_idx" ON "consent_grants" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "consent_grants_connection_idx" ON "consent_grants" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_versions_def_version_key" ON "consent_versions" USING btree ("definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_handle_key" ON "devices" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "devices_user_lastseen_idx" ON "devices" USING btree ("user_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_scope_key" ON "idempotency_keys" USING btree ("scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_expires_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_key" ON "notification_preferences" USING btree ("user_id","category","channel");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_key" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "organizations_status_created_idx" ON "organizations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("published_at","created_at");--> statement-breakpoint
CREATE INDEX "outbox_channel_idx" ON "outbox_events" USING btree ("channel","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_org_key" ON "partner_connections" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_org_ref_key" ON "partner_connections" USING btree ("organization_id","partner_ref");--> statement-breakpoint
CREATE INDEX "connections_org_state_idx" ON "partner_connections" USING btree ("organization_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "presentations_replay_key" ON "pass_presentations" USING btree ("pass_id","counter","organization_id");--> statement-breakpoint
CREATE INDEX "presentations_org_created_idx" ON "pass_presentations" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "presentations_pass_created_idx" ON "pass_presentations" USING btree ("pass_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passes_ref_key" ON "passes" USING btree ("pass_ref");--> statement-breakpoint
CREATE INDEX "passes_user_status_idx" ON "passes" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_methods_provider_token_key" ON "payment_methods" USING btree ("provider","provider_token");--> statement-breakpoint
CREATE INDEX "payment_methods_user_idx" ON "payment_methods" USING btree ("user_id","removed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_pk" ON "role_permissions" USING btree ("role_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_key" ON "roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "security_severity_created_idx" ON "security_events" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "security_user_created_idx" ON "security_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "security_org_created_idx" ON "security_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "security_created_idx" ON "security_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_active_idx" ON "sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tickets_status_created_idx" ON "support_tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tickets_user_created_idx" ON "support_tickets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_org_idem_key" ON "transactions" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_provider_order_key" ON "transactions" USING btree ("provider","provider_order_id");--> statement-breakpoint
CREATE INDEX "transactions_user_created_idx" ON "transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_org_created_idx" ON "transactions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_status_created_idx" ON "transactions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_user_key" ON "user_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_roles_unique" ON "user_roles" USING btree ("user_id","role_id","membership_id");--> statement-breakpoint
CREATE INDEX "user_roles_membership_idx" ON "user_roles" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_mobile_key" ON "users" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "users_status_created_idx" ON "users" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "users_created_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "verifications_user_purpose_idx" ON "verification_requests" USING btree ("user_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "verifications_dest_purpose_idx" ON "verification_requests" USING btree ("destination","purpose","created_at");--> statement-breakpoint
CREATE INDEX "verifications_expires_idx" ON "verification_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_hook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "webhooks_org_active_idx" ON "webhooks" USING btree ("organization_id","active");