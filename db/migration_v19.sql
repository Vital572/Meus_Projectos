-- v19: colunas que iniciam automaticamente o registo de tempo
SET search_path TO gpitrack;
ALTER TABLE board_columns ADD COLUMN IF NOT EXISTS timer_start BOOLEAN NOT NULL DEFAULT false;
