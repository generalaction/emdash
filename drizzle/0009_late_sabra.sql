CREATE INDEX `idx_automation_runs_automation_status` ON `automation_runs` (`automation_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_automations_enabled_trigger_event` ON `automations` (`enabled`,`trigger_type`,`event_type`);--> statement-breakpoint
CREATE INDEX `idx_automations_project_id` ON `automations` (`project_id`);