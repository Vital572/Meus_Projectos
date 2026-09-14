-- ============================================================
-- GPI Track — Migração v5
-- Adiciona: reuniões de projeto (parte do novo Espaço de Gestão
-- do membro — equipas, tarefas, projetos, membros, relatórios e
-- reuniões, distinto da Administração da plataforma).
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

CREATE TABLE IF NOT EXISTS meetings (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    location      VARCHAR(200),
    created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project_id, scheduled_at);
