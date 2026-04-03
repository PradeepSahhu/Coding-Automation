CREATE TABLE IF NOT EXISTS agent_instructions (
  id SERIAL PRIMARY KEY,
  issue_id VARCHAR(20) NOT NULL,
  instructions TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  last_error TEXT,
  pr_owner TEXT,
  pr_repo TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ 
);

ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS pr_owner TEXT;
ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS pr_repo TEXT;
ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS pr_number INTEGER;
ALTER TABLE agent_instructions ADD COLUMN IF NOT EXISTS pr_url TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_instructions_status
ON agent_instructions (status);

CREATE INDEX IF NOT EXISTS idx_agent_instructions_pr_lookup
ON agent_instructions (pr_owner, pr_repo, pr_number);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
  id SERIAL PRIMARY KEY,
  instruction_id INTEGER NOT NULL,
  issue_id VARCHAR(20),
  instructions TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_instruction_id
ON dead_letter_queue (instruction_id);

CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_failed_at
ON dead_letter_queue (failed_at DESC);

CREATE OR REPLACE FUNCTION notify_agent_instruction() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('agent_instruction_created', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_agent_instruction ON agent_instructions;
CREATE TRIGGER trg_notify_agent_instruction
AFTER INSERT ON agent_instructions
FOR EACH ROW
EXECUTE FUNCTION notify_agent_instruction();

INSERT INTO agent_instructions (issue_id, instructions)
SELECT 'BOOT-1', 'Default instruction: analyze the request and respond concisely.'
WHERE NOT EXISTS (SELECT 1 FROM agent_instructions);
