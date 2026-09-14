-- ============================================================
-- GPI Track — Migração v2
-- Adiciona: papéis de administrador, estado da conta, etiquetas,
-- checklist e notificações.
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

-- Utilizadores: papel, estado da conta e última atividade
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'member';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Etiquetas
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

-- Checklist
CREATE TABLE IF NOT EXISTS checklist_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    content    VARCHAR(255) NOT NULL,
    is_done    BOOLEAN NOT NULL DEFAULT false,
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id);

-- Notificações
CREATE TABLE IF NOT EXISTS notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    type       VARCHAR(30) NOT NULL,
    content    TEXT NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Torna administrador o primeiro utilizador criado (ajuste o e-mail se necessário)
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1);
