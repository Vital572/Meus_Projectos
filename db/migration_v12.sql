-- Migração v12
-- Adiciona a visibilidade da tarefa: "equipa" (todos os membros do projeto
-- veem) ou "restrita" (só responsáveis do projeto, administradores, e os
-- responsáveis/atribuído dessa tarefa específica veem).
ALTER TABLE gpitrack.tasks
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'equipa';
