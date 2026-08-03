// AUTO-GENERATED — do not edit. Re-run the bundle-drizzle-migrations script.
import type { BundledMigration } from '@primitives/sqlite-store/api';

export const migrations: readonly BundledMigration[] = [
  {
    idx: 0,
    tag: "0000_youthful_unicorn",
    when: 1785781179174,
    hash: "e77e7ac08ad0c956cee4e26108dd7764551da230e68c1b3ae8c73dc66bcb03ba",
    sql: "CREATE TABLE `operation_claims` (\n\t`operation_id` text NOT NULL,\n\t`resource` text NOT NULL,\n\t`key` text NOT NULL,\n\t`mode` text NOT NULL,\n\t`implicit` integer NOT NULL,\n\tFOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade\n);\n--> statement-breakpoint\nCREATE INDEX `operation_claims_operation_idx` ON `operation_claims` (`operation_id`);--> statement-breakpoint\nCREATE INDEX `operation_claims_resource_key_idx` ON `operation_claims` (`resource`,`key`);--> statement-breakpoint\nCREATE TABLE `operation_transitions` (\n\t`operation_id` text NOT NULL,\n\t`from_status` text NOT NULL,\n\t`to_status` text NOT NULL,\n\t`at` integer NOT NULL,\n\t`cause` text NOT NULL,\n\tFOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade\n);\n--> statement-breakpoint\nCREATE INDEX `operation_transitions_operation_idx` ON `operation_transitions` (`operation_id`);--> statement-breakpoint\nCREATE INDEX `operation_transitions_at_idx` ON `operation_transitions` (`at`);--> statement-breakpoint\nCREATE TABLE `operations` (\n\t`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,\n\t`id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`key` text NOT NULL,\n\t`input` text NOT NULL,\n\t`status` text NOT NULL,\n\t`attempt` integer NOT NULL,\n\t`not_before` integer,\n\t`parent_id` text,\n\t`initiator` text NOT NULL,\n\t`propagation` text,\n\t`result` text,\n\t`rejected_error` text,\n\t`error` text,\n\t`outcome` text,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `operations_id_idx` ON `operations` (`id`);--> statement-breakpoint\nCREATE INDEX `operations_status_idx` ON `operations` (`status`);--> statement-breakpoint\nCREATE INDEX `operations_key_idx` ON `operations` (`key`);--> statement-breakpoint\nCREATE INDEX `operations_parent_status_idx` ON `operations` (`parent_id`,`status`);",
  },
];
