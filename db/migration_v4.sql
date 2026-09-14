-- ============================================================
-- GPI Track — Migração v4
-- Adiciona: anexos de tarefas enviados ao responsável do projeto
-- (botão "Enviar ao responsável" no detalhe da tarefa).
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo
-- (ou migration_v2.sql / migration_v3.sql). Se está a instalar o
-- projeto pela primeira vez, ignore este ficheiro e use apenas o
-- db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

CREATE TABLE IF NOT EXISTS task_attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id      UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
    uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    sent_to      UUID REFERENCES users(id) ON DELETE SET NULL,
    file_name    VARCHAR(255) NOT NULL,
    stored_name  VARCHAR(255) NOT NULL,
    file_size    INTEGER NOT NULL,
    mime_type    VARCHAR(150),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
