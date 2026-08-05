// AUTO-GENERATED — do not edit. Re-run the bundle-drizzle-migrations script.
import type { BundledMigration } from '@primitives/sqlite-store/api';

export const migrations: readonly BundledMigration[] = [
  {
    idx: 0,
    tag: '0000_thankful_white_tiger',
    when: 1785962601628,
    hash: '943970b0e5503eb7f89f038d1c551f47d0fe394999e2908ce1ac1f77a12b6a43',
    sql: 'CREATE TABLE `workspace_records` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`kind` text NOT NULL,\n\t`path` text NOT NULL,\n\t`parent_id` text,\n\t`origin` text NOT NULL,\n\t`git_admin_name` text,\n\t`observed_status` text NOT NULL,\n\t`creation` text,\n\t`last_create_outcome` text,\n\t`git` text,\n\t`last_activated_at` integer,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`last_observed_at` integer NOT NULL\n);\n--> statement-breakpoint\nCREATE UNIQUE INDEX `workspace_records_path_unique` ON `workspace_records` (`path`);',
  },
];
