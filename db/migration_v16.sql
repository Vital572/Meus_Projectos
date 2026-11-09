-- GPI Track — migração v16: índices em colunas de ligação (chaves estrangeiras)
SET search_path TO gpitrack;

--
-- Descoberto no teste de carga (db/carga.js): várias colunas muito usadas em
-- consultas e em eliminações em cascata não tinham índice, por isso o
-- PostgreSQL tinha de percorrer a tabela inteira de cada vez ("Seq Scan").
-- Com poucos dados não se nota; com milhares de tarefas, mensagens e
-- notificações, pesquisar "as minhas tarefas", eliminar um projeto ou uma
-- conta passa a custar cada vez mais. É seguro correr várias vezes.

-- "As minhas tarefas", relatórios por pessoa, eliminar uma conta
CREATE INDEX IF NOT EXISTS idx_tasks_assignee            ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by          ON tasks(created_by);
-- "Os meus projetos" (a chave primária só ajuda a procurar por projeto, não por pessoa)
CREATE INDEX IF NOT EXISTS idx_project_members_user      ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_task_responsibles_user    ON task_responsibles(user_id);
-- Comentários, atividade, conversa
CREATE INDEX IF NOT EXISTS idx_comments_user             ON comments(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_user             ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_user     ON channel_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_messages_reply    ON channel_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_channel_reactions_user    ON channel_message_reactions(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_hidden_user       ON channel_message_hidden(user_id);
-- Notificações ligadas a um projeto/tarefa (eliminar projetos e tarefas)
CREATE INDEX IF NOT EXISTS idx_notifications_project     ON notifications(project_id);
CREATE INDEX IF NOT EXISTS idx_notifications_task        ON notifications(task_id);
-- Etiquetas, campos, dependências, metas
CREATE INDEX IF NOT EXISTS idx_labels_project            ON labels(project_id);
CREATE INDEX IF NOT EXISTS idx_task_labels_label         ON task_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_task_custom_values_field  ON task_custom_values(field_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends ON task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_goal_tasks_task           ON goal_tasks(task_id);
-- Anexos e automações
CREATE INDEX IF NOT EXISTS idx_task_attachments_project  ON task_attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_sent_to  ON task_attachments(sent_to);
CREATE INDEX IF NOT EXISTS idx_automations_trigger       ON automations(trigger_column_id);
-- Equipas e projetos por criador (a limpeza e a eliminação de contas usam-nos)
CREATE INDEX IF NOT EXISTS idx_projects_created_by       ON projects(created_by);
CREATE INDEX IF NOT EXISTS idx_projects_team             ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user         ON team_members(user_id);
