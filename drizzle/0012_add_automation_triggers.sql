-- Add trigger support columns to automations table
ALTER TABLE `automations` ADD COLUMN `mode` text DEFAULT 'schedule' NOT NULL;
ALTER TABLE `automations` ADD COLUMN `trigger_type` text;
ALTER TABLE `automations` ADD COLUMN `trigger_config` text;
