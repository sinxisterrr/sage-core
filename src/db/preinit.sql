-- Pre-initialization: Ensure conversation_log has all required columns
-- This runs before the main schema to handle existing databases

-- Add columns if they don't exist
DO $$
BEGIN
    -- Check if conversation_log table exists first
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversation_log') THEN
        -- Add parser_weights if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'conversation_log' AND column_name = 'parser_weights'
        ) THEN
            ALTER TABLE conversation_log ADD COLUMN parser_weights JSONB DEFAULT '{}'::jsonb;
        END IF;

        -- Add relevance_score if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'conversation_log' AND column_name = 'relevance_score'
        ) THEN
            ALTER TABLE conversation_log ADD COLUMN relevance_score NUMERIC(5,2);
        END IF;

        -- Add importance_score if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'conversation_log' AND column_name = 'importance_score'
        ) THEN
            ALTER TABLE conversation_log ADD COLUMN importance_score NUMERIC(5,2);
        END IF;
    END IF;
END $$;
