-- v18: responsáveis de grupo (podem gerir o grupo que lhes foi atribuído)
SET search_path TO gpitrack;
ALTER TABLE channel_group_members ADD COLUMN IF NOT EXISTS papel VARCHAR(12) NOT NULL DEFAULT 'membro'; -- 'membro' | 'responsavel'
