CREATE TABLE "event_host_availability" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type_id" text NOT NULL,
	"user_did" text NOT NULL,
	"date" date NOT NULL,
	"timezone" text NOT NULL,
	"start_minutes" integer,
	"end_minutes" integer,
	"unavailable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD COLUMN "availability_mode" text DEFAULT 'schedule' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_host_availability" ADD CONSTRAINT "event_host_availability_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_host_availability" ADD CONSTRAINT "event_host_availability_user_did_users_did_fk" FOREIGN KEY ("user_did") REFERENCES "public"."users"("did") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_host_availability_idx" ON "event_host_availability" USING btree ("event_type_id","user_did","date");