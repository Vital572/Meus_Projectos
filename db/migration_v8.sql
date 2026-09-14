-- ============================================================
-- GPI Track — Migração v8
-- Adiciona:
--  1) Vários responsáveis por projeto (project_members.role)
--  2) Colunas restritas a responsáveis/administradores (board_columns.restricted)
--  3) Caixa de feedback (tabela feedback)
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'membro';

-- O criador original de cada projeto passa a ser marcado como responsável
UPDATE project_members pm
SET role = 'responsavel'
FROM projects p
WHERE p.id = pm.project_id AND p.created_by = pm.user_id AND pm.role = 'membro';

ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS restricted BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS feedback (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(150),
    email       VARCHAR(255),
    message     TEXT NOT NULL,
    page        VARCHAR(100),
    user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    is_read     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
