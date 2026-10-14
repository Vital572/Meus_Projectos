-- Migração v13
-- 1) Login com Google: guarda o identificador Google da conta e permite contas
--    sem password local (quem entra só com Google).
-- 2) Preferência de notificações por e-mail (ligada por defeito).
-- 3) Recuperação de conta: tokens de redefinição de password (guardados só
--    como hash SHA-256, com validade curta e uso único).
ALTER TABLE gpitrack.users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE gpitrack.users ADD COLUMN IF NOT EXISTS google_id VARCHAR(64);
ALTER TABLE gpitrack.users ADD COLUMN IF NOT EXISTS email_notificacoes BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS users_google_id_uq ON gpitrack.users (google_id) WHERE google_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS gpitrack.password_resets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES gpitrack.users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON gpitrack.password_resets (user_id);
