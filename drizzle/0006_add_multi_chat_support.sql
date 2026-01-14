-- Add multi-chat support fields to conversations table
ALTER TABLE conversations ADD COLUMN provider TEXT;
ALTER TABLE conversations ADD COLUMN is_active INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN display_order INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN metadata TEXT;

-- Update existing conversations to be active (first chat in each task)
UPDATE conversations SET is_active = 1, display_order = 0 WHERE is_active IS NULL;

-- Create index for quick active conversation lookup
CREATE INDEX IF NOT EXISTS idx_conversations_active ON conversations (task_id, is_active);