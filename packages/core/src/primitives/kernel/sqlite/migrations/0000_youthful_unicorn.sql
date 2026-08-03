CREATE TABLE `operation_claims` (
	`operation_id` text NOT NULL,
	`resource` text NOT NULL,
	`key` text NOT NULL,
	`mode` text NOT NULL,
	`implicit` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operation_claims_operation_idx` ON `operation_claims` (`operation_id`);--> statement-breakpoint
CREATE INDEX `operation_claims_resource_key_idx` ON `operation_claims` (`resource`,`key`);--> statement-breakpoint
CREATE TABLE `operation_transitions` (
	`operation_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`at` integer NOT NULL,
	`cause` text NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operation_transitions_operation_idx` ON `operation_transitions` (`operation_id`);--> statement-breakpoint
CREATE INDEX `operation_transitions_at_idx` ON `operation_transitions` (`at`);--> statement-breakpoint
CREATE TABLE `operations` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`name` text NOT NULL,
	`key` text NOT NULL,
	`input` text NOT NULL,
	`status` text NOT NULL,
	`attempt` integer NOT NULL,
	`not_before` integer,
	`parent_id` text,
	`initiator` text NOT NULL,
	`propagation` text,
	`result` text,
	`rejected_error` text,
	`error` text,
	`outcome` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operations_id_idx` ON `operations` (`id`);--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `operations` (`status`);--> statement-breakpoint
CREATE INDEX `operations_key_idx` ON `operations` (`key`);--> statement-breakpoint
CREATE INDEX `operations_parent_status_idx` ON `operations` (`parent_id`,`status`);