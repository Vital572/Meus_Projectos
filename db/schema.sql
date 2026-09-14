-- ============================================================
-- GPI Track — Esquema da Base de Dados
-- Ferramenta de Gestão de Projetos Colaborativa em Tempo Real
-- ============================================================

CREATE SCHEMA IF NOT EXISTS gpitrack;
SET search_path TO gpitrack;

-- Extensão para gerar UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- Utilizadores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(160) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    avatar_color  VARCHAR(7)   NOT NULL DEFAULT '#0EA5B7',
    role          VARCHAR(20)  NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    is_active     BOOLEAN      NOT NULL DEFAULT true,
    last_seen_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Equipas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(150) NOT NULL,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id  UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    role     VARCHAR(20) NOT NULL DEFAULT 'member', -- 'admin' | 'member'
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

-- ------------------------------------------------------------
-- Projetos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID REFERENCES teams(id) ON DELETE CASCADE,
    name        VARCHAR(150) NOT NULL,
    description TEXT,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    role       VARCHAR(20) NOT NULL DEFAULT 'membro', -- 'responsavel' | 'membro' — pode haver vários responsáveis
    status     VARCHAR(20) NOT NULL DEFAULT 'ativo', -- 'pendente' (convite por aceitar) | 'ativo'
    invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (project_id, user_id)
);

-- ------------------------------------------------------------
-- Colunas do quadro Kanban (por projeto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_columns (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    name        VARCHAR(60) NOT NULL,
    position    INTEGER NOT NULL,
    is_done     BOOLEAN NOT NULL DEFAULT false, -- marca esta coluna como "tarefa concluída" (usado nos relatórios/gráficos)
    restricted  BOOLEAN NOT NULL DEFAULT false, -- só responsáveis/administradores veem/gerem esta coluna (ex.: "Em Revisão")
    UNIQUE (project_id, position)
);

-- ------------------------------------------------------------
-- Tarefas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
    column_id    UUID REFERENCES board_columns(id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL,
    description  TEXT,
    priority     VARCHAR(10) NOT NULL DEFAULT 'media', -- 'baixa' | 'media' | 'alta'
    assignee_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date     DATE,
    position     INTEGER NOT NULL DEFAULT 0,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    reminded_day_before BOOLEAN NOT NULL DEFAULT false, -- já foi notificado "falta 1 dia"
    reminded_due_day    BOOLEAN NOT NULL DEFAULT false  -- já foi notificado "é hoje"
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id);

-- ------------------------------------------------------------
-- Comentários (em tempo real, por tarefa)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    content    TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id);

-- ------------------------------------------------------------
-- Registo de atividade (auditoria / histórico do projeto)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(50) NOT NULL,  -- 'task.created', 'task.moved', 'comment.created', ...
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_log(project_id, created_at DESC);

-- ------------------------------------------------------------
-- Etiquetas (labels) por projeto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    name       VARCHAR(40) NOT NULL,
    color      VARCHAR(7)  NOT NULL DEFAULT '#22C7DD'
);

CREATE TABLE IF NOT EXISTS task_labels (
    task_id  UUID REFERENCES tasks(id) ON DELETE CASCADE,
    label_id UUID REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
);

-- ------------------------------------------------------------
-- Checklist (subtarefas) por tarefa
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS checklist_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    content    VARCHAR(255) NOT NULL,
    is_done    BOOLEAN NOT NULL DEFAULT false,
    position   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id);

-- ------------------------------------------------------------
-- Anexos de tarefas enviados diretamente ao responsável do
-- projeto (botão "Enviar ao responsável"). O ficheiro em si fica
-- gravado em disco (pasta /uploads); aqui fica só o registo/metadados.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_to      UUID REFERENCES users(id) ON DELETE SET NULL, -- responsável do projeto no momento do envio
    file_name    VARCHAR(255) NOT NULL,  -- nome original do ficheiro
    stored_name  VARCHAR(255) NOT NULL,  -- nome único gravado em /uploads/task-attachments
    file_size    INTEGER NOT NULL,
    mime_type    VARCHAR(150),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);

-- ------------------------------------------------------------
-- Responsáveis extra de uma tarefa (além do responsável principal
-- em tasks.assignee_id) — só o responsável do projeto ou um
-- administrador pode geri-los.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_responsibles (
    task_id  UUID REFERENCES tasks(id) ON DELETE CASCADE,
    user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);

-- ------------------------------------------------------------
-- Reuniões — agendadas dentro de um projeto. Todos os membros do
-- projeto são participantes implícitos (sem necessidade de os
-- selecionar um a um) e são notificados quando é marcada uma.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meetings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    location      VARCHAR(200), -- link da chamada ou local físico
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project_id, scheduled_at);

-- ------------------------------------------------------------
-- Canal de conversa geral do projeto (à parte dos comentários por
-- tarefa) — inspirado no Slack.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    content     TEXT, -- texto da mensagem (pode ser vazio se for só um ficheiro/áudio)
    type        VARCHAR(20) NOT NULL DEFAULT 'texto', -- 'texto' | 'imagem' | 'ficheiro' | 'audio'
    file_name   VARCHAR(255),
    stored_name VARCHAR(255), -- nome único em /uploads/channel-media
    file_size   INTEGER,
    mime_type   VARCHAR(150),
    duration_seconds INTEGER, -- duração de mensagens de áudio
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_project ON channel_messages(project_id, created_at);

-- ------------------------------------------------------------
-- Automações por projeto — inspirado no Monday.com. Quando uma
-- tarefa entra na coluna "trigger_column_id", executa "action_type":
--  'notificar'         -> notifica notify_user_id (ou o responsável, se NULL)
--  'atribuir'          -> atribui a tarefa a assign_user_id
--  'definir_prioridade'-> muda a prioridade da tarefa para set_priority
--  'concluir_checklist'-> marca todos os itens da checklist como feitos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
    name               VARCHAR(150) NOT NULL,
    trigger_column_id  UUID REFERENCES board_columns(id) ON DELETE CASCADE,
    action_type        VARCHAR(30) NOT NULL DEFAULT 'notificar',
    notify_user_id     UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL = notifica o responsável do projeto
    assign_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    set_priority       VARCHAR(10),
    active             BOOLEAN NOT NULL DEFAULT true,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);

-- ------------------------------------------------------------
-- Feedback enviado pela página inicial pública ou pelo Espaço de
-- Gestão. Fica guardado aqui e visível na Administração — para já
-- não é enviado por e-mail (a plataforma ainda não tem um serviço
-- de envio de e-mail configurado).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(150),
    email       VARCHAR(255),
    message     TEXT NOT NULL,
    page        VARCHAR(100), -- de onde foi enviado: "home" | "espaco-gestao"
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

-- ------------------------------------------------------------
-- Notificações (atribuição de tarefas, comentários, menções, convites)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    type       VARCHAR(50) NOT NULL, -- 'task.assigned' | 'comment.new' | 'mention' | 'project.invited'
    content    TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ------------------------------------------------------------
-- Mensagens administrativas (anúncios/broadcast enviados por um
-- administrador a todos os utilizadores, a um projeto ou a uma
-- pessoa específica). Cada envio gera uma notificação em tempo
-- real para cada destinatário, e fica aqui registado como histórico.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_messages (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    content             TEXT NOT NULL,
    audience            VARCHAR(20) NOT NULL, -- 'todos' | 'projeto' | 'utilizador'
    project_id          UUID REFERENCES projects(id) ON DELETE SET NULL,
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    total_destinatarios INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_created ON admin_messages(created_at DESC);

-- ------------------------------------------------------------
-- Trigger: atualizar automaticamente "updated_at" nas tarefas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
