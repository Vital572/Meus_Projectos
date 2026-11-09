-- v17: conversa da equipa — fixar mensagens e grupos (sub-conversas)
SET search_path TO gpitrack;

-- Grupos criados por administradores/responsáveis (ex.: grupo de uma tarefa).
CREATE TABLE IF NOT EXISTS channel_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL,
    task_id     UUID REFERENCES tasks(id) ON DELETE SET NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channel_groups_project ON channel_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_channel_groups_task    ON channel_groups(task_id);

CREATE TABLE IF NOT EXISTS channel_group_members (
    group_id  UUID NOT NULL REFERENCES channel_groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_group_members_user ON channel_group_members(user_id);

-- group_id NULL = conversa geral do projeto
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS group_id  UUID REFERENCES channel_groups(id) ON DELETE CASCADE;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_channel_messages_group  ON channel_messages(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_channel_messages_pinned ON channel_messages(project_id, pinned_at) WHERE pinned_at IS NOT NULL;
