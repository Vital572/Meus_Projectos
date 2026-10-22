-- Migração v15 — conjunto grande de funcionalidades inspiradas nas 5
-- ferramentas estudadas no trabalho (Slack, Asana, ClickUp, Monday.com,
-- Smartsheet):
--   Monday/Smartsheet: Gantt (start_date), campos personalizados por projeto
--   Asana: subtarefas reais (parent_task_id), dependências entre tarefas
--   ClickUp: registo de tempo, metas/objetivos do projeto
--   Slack: reações emoji, responder a uma mensagem, menções @nome
--   Transversal: autenticação multifator (TOTP)

-- ---------- Gantt: data de início da tarefa ----------
ALTER TABLE gpitrack.tasks ADD COLUMN IF NOT EXISTS start_date DATE;

-- ---------- Subtarefas reais ----------
ALTER TABLE gpitrack.tasks ADD COLUMN IF NOT EXISTS parent_task_id UUID REFERENCES gpitrack.tasks(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON gpitrack.tasks(parent_task_id);

-- ---------- Dependências entre tarefas ----------
-- "task_id" só pode começar depois de "depends_on_task_id" terminar.
CREATE TABLE IF NOT EXISTS gpitrack.task_dependencies (
    task_id            UUID NOT NULL REFERENCES gpitrack.tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES gpitrack.tasks(id) ON DELETE CASCADE,
    created_by         UUID REFERENCES gpitrack.users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id)
);

-- ---------- Campos personalizados por projeto ----------
CREATE TABLE IF NOT EXISTS gpitrack.project_custom_fields (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES gpitrack.projects(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL,
    type        VARCHAR(20) NOT NULL DEFAULT 'texto', -- 'texto' | 'numero' | 'data' | 'lista'
    options     JSONB, -- lista de opções, só para type = 'lista'
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON gpitrack.project_custom_fields(project_id);

CREATE TABLE IF NOT EXISTS gpitrack.task_custom_values (
    task_id   UUID NOT NULL REFERENCES gpitrack.tasks(id) ON DELETE CASCADE,
    field_id  UUID NOT NULL REFERENCES gpitrack.project_custom_fields(id) ON DELETE CASCADE,
    value     TEXT,
    PRIMARY KEY (task_id, field_id)
);

-- ---------- Registo de tempo (cronómetro por tarefa) ----------
CREATE TABLE IF NOT EXISTS gpitrack.time_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES gpitrack.tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES gpitrack.users(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ, -- NULL = cronómetro ainda a correr
    seconds     INTEGER, -- preenchido quando termina (ended_at - started_at)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON gpitrack.time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user ON gpitrack.time_entries(user_id);
-- Só pode haver um cronómetro a correr (ended_at NULL) por pessoa de cada vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_time_entries_running ON gpitrack.time_entries(user_id) WHERE ended_at IS NULL;

-- ---------- Metas/objetivos do projeto ----------
CREATE TABLE IF NOT EXISTS gpitrack.project_goals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES gpitrack.projects(id) ON DELETE CASCADE,
    name         VARCHAR(200) NOT NULL,
    description  TEXT,
    target_date  DATE,
    created_by   UUID REFERENCES gpitrack.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_goals_project ON gpitrack.project_goals(project_id);

CREATE TABLE IF NOT EXISTS gpitrack.goal_tasks (
    goal_id  UUID NOT NULL REFERENCES gpitrack.project_goals(id) ON DELETE CASCADE,
    task_id  UUID NOT NULL REFERENCES gpitrack.tasks(id) ON DELETE CASCADE,
    PRIMARY KEY (goal_id, task_id)
);

-- ---------- Reações emoji nas mensagens do canal ----------
CREATE TABLE IF NOT EXISTS gpitrack.channel_message_reactions (
    message_id  UUID NOT NULL REFERENCES gpitrack.channel_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES gpitrack.users(id) ON DELETE CASCADE,
    emoji       VARCHAR(16) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

-- ---------- Responder a uma mensagem específica ----------
ALTER TABLE gpitrack.channel_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES gpitrack.channel_messages(id) ON DELETE SET NULL;

-- ---------- Autenticação multifator (TOTP) ----------
ALTER TABLE gpitrack.users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(64);
ALTER TABLE gpitrack.users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;
