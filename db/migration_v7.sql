-- ============================================================
-- GPI Track — Migração v7
-- Adiciona: sinalizador "is_done" nas colunas do quadro (para
-- escolher qual coluna representa "tarefa concluída" nos
-- relatórios/gráficos, em vez de depender do nome "Concluído").
--
-- Execute este script no Query Tool do pgAdmin, dentro da base
-- de dados "gpitrack", SE já tinha corrido o schema.sql antigo.
-- Se está a instalar o projeto pela primeira vez, ignore este
-- ficheiro e use apenas o db/schema.sql (já atualizado).
-- ============================================================

SET search_path TO gpitrack;

ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS is_done BOOLEAN NOT NULL DEFAULT false;

-- Nos projetos já existentes, assume que a coluna chamada "Concluído"
-- (criada por omissão até agora) é a coluna de tarefas concluídas.
UPDATE board_columns SET is_done = true WHERE name = 'Concluído' AND is_done = false;
