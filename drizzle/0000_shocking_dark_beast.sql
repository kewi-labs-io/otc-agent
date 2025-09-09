CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"user_id" text NOT NULL,
	"beneficiary" text,
	"token_amount" text NOT NULL,
	"discount_bps" integer NOT NULL,
	"apr" real NOT NULL,
	"lockup_months" integer NOT NULL,
	"lockup_days" integer NOT NULL,
	"payment_currency" text NOT NULL,
	"price_usd_per_token" real NOT NULL,
	"total_usd" real NOT NULL,
	"discount_usd" real NOT NULL,
	"discounted_usd" real NOT NULL,
	"payment_amount" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"signature" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"expires_at" timestamp NOT NULL,
	"executed_at" timestamp,
	"rejected_at" timestamp,
	"approved_at" timestamp,
	"offer_id" text,
	"transaction_hash" text,
	"block_number" integer,
	"rejection_reason" text,
	"approval_note" text,
	CONSTRAINT "quotes_quote_id_unique" UNIQUE("quote_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"wallet_address" text,
	"quotes_created" integer DEFAULT 0 NOT NULL,
	"last_quote_at" timestamp,
	"daily_quote_count" integer DEFAULT 0 NOT NULL,
	"daily_reset_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"total_deals" integer DEFAULT 0 NOT NULL,
	"total_volume_usd" real DEFAULT 0 NOT NULL,
	"total_saved_usd" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "user_sessions_user_id_unique" UNIQUE("user_id")
);