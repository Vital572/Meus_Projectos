-- ============================================================
-- GPI Track — Migração v9
-- Adiciona:
--  1) Convites de projeto com aceitar/recusar (project_members.status)
--  2) Lembretes automáticos de prazo de tarefa (tasks.reminded_*)
--  3) Ficheiros/áudio/imagens no canal de conversa (channel_messages)
--  4) Novos tipos de automação (atribuir, prioridade, checklist)
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

ALTER TABLE project_members ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ativo';
ALTER TABLE project_members ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_day_before BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminded_due_day BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE channel_messages ALTER COLUMN content DROP NOT NULL;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'texto';
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS stored_name VARCHAR(255);
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(150);
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

ALTER TABLE automations ADD COLUMN IF NOT EXISTS action_type VARCHAR(30) NOT NULL DEFAULT 'notificar';
ALTER TABLE automations ADD COLUMN IF NOT EXISTS assign_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE automations ADD COLUMN IF NOT EXISTS set_priority VARCHAR(10);
