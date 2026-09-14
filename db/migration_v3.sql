-- ============================================================
-- GPI Track — Migração v3
-- Adiciona: mensagens administrativas (separadores "Notificações"
-- e "Mensagens" no painel de administração).
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo
-- (ou o migration_v2.sql). Se está a instalar o projeto pela
-- primeira vez, ignore este ficheiro e use apenas o db/schema.sql
-- (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

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
