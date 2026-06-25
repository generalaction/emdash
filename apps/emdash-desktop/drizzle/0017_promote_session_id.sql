-- Promote the agent-native session id from the config JSON blob into the
-- conversations.session_id column, making it the single authoritative field.
--
-- Before this migration:
--   - PTY rows: session_id = conversation.id (spawn guard; native id in config.providerSessionId)
--   - ACP rows: session_id = NULL; native id in config.providerSessionId
--
-- After this migration:
--   - Rows that had a native id in config: session_id overwritten to that id
--   - PTY rows without a native id: session_id unchanged (= conversation.id)
--   - ACP rows without a native id: session_id remains NULL (never spawned)

UPDATE `conversations`
SET `session_id` = json_extract(`config`, '$.providerSessionId')
WHERE json_extract(`config`, '$.providerSessionId') IS NOT NULL;

UPDATE `conversations`
SET `config` = json_remove(`config`, '$.providerSessionId')
WHERE json_extract(`config`, '$.providerSessionId') IS NOT NULL;
