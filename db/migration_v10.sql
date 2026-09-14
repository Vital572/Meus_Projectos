-- ============================================================
-- GPI Track — Migração v10
-- Adiciona: vários responsáveis por tarefa (além do responsável
-- principal), geridos só por responsáveis do projeto/administradores.
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

CREATE TABLE IF NOT EXISTS task_responsibles (
    task_id  UUID REFERENCES tasks(id) ON DELETE CASCADE,
    user_id  UUID REFERENCES users(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);
