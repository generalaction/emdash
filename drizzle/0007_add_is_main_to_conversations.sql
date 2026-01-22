-- Add is_main column to conversations table
ALTER TABLE conversations ADD COLUMN is_main INTEGER NOT NULL DEFAULT 0;

-- Mark first conversation of each task as main (for backward compatibility)
UPDATE conversations
SET is_main = 1
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY task_id ORDER BY created_at ASC) as rn
    FROM conversations
  ) t
  WHERE rn = 1
);