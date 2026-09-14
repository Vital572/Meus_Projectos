-- ============================================================
-- GPI Track — Migração v11
-- Corrige: a coluna notifications.type era VARCHAR(30), curta
-- demais para os tipos mais recentes (ex.: "project.invite_approval_request",
-- com 31 caracteres), o que fazia falhar o envio dessas notificações.
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

ALTER TABLE notifications ALTER COLUMN type TYPE VARCHAR(50);
