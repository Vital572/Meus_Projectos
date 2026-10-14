-- Migração v14
-- 1) Editar/eliminar mensagens do canal de conversa da equipa:
--    - edited_at: marca "(editada)" quando a mensagem de texto foi alterada.
--    - deleted_at + deleted_by: eliminação "para todos" — o conteúdo deixa de
--      ser mostrado a ninguém, aparece "Mensagem eliminada".
--    - channel_message_hidden: eliminação "só para mim" — a mensagem continua
--      visível para todos os outros, só deixa de aparecer para quem a ocultou.
ALTER TABLE gpitrack.channel_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE gpitrack.channel_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE gpitrack.channel_messages ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES gpitrack.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS gpitrack.channel_message_hidden (
    message_id  UUID NOT NULL REFERENCES gpitrack.channel_messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES gpitrack.users(id) ON DELETE CASCADE,
    hidden_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);
