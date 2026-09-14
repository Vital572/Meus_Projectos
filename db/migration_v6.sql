-- ============================================================
-- GPI Track — Migração v6
-- Adiciona: canal de conversa geral do projeto (Slack) e
-- automações simples por coluna (Monday.com).
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

CREATE TABLE IF NOT EXISTS channel_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_project ON channel_messages(project_id, created_at);

CREATE TABLE IF NOT EXISTS automations (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
    name               VARCHAR(150) NOT NULL,
    trigger_column_id  UUID REFERENCES board_columns(id) ON DELETE CASCADE,
    notify_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    active             BOOLEAN NOT NULL DEFAULT true,
    created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
