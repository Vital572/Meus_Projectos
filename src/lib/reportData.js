const pool = require("../../db/pool");

/**
 * Reúne todos os dados necessários para os relatórios administrativos:
 * projetos (com tarefas, responsáveis, etiquetas e progresso da checklist),
 * membros por projeto, e um resumo agregado por utilizador.
 */
async function obterDadosRelatorio() {
  const { rows: projetos } = await pool.query(`
    SELECT p.id, p.name, p.description, p.created_at,
           t.name AS team_name,
           u.name AS criado_por, u.email AS criado_por_email
    FROM gpitrack.projects p
    LEFT JOIN gpitrack.teams t ON t.id = p.team_id
    LEFT JOIN gpitrack.users u ON u.id = p.created_by
    ORDER BY p.created_at ASC
  `);

  const { rows: tarefas } = await pool.query(`
    SELECT t.id, t.project_id, t.title, t.description, t.priority, t.due_date,
           t.created_at,
           c.name AS coluna,
           c.is_done AS coluna_concluida,
           ua.name AS responsavel_nome, ua.email AS responsavel_email,
           uc.name AS criado_por,
           COALESCE(chk.total, 0) AS checklist_total,
           COALESCE(chk.feitos, 0) AS checklist_feitos,
           COALESCE(cm.total, 0) AS total_comentarios,
           COALESCE(lbl.etiquetas, '[]'::json) AS labels
    FROM gpitrack.tasks t
    LEFT JOIN gpitrack.board_columns c ON c.id = t.column_id
    LEFT JOIN gpitrack.users ua ON ua.id = t.assignee_id
    LEFT JOIN gpitrack.users uc ON uc.id = t.created_by
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_done)::int AS feitos
      FROM gpitrack.checklist_items ci WHERE ci.task_id = t.id
    ) chk ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS total FROM gpitrack.comments cm WHERE cm.task_id = t.id
    ) cm ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('name', l.name, 'color', l.color)) AS etiquetas
      FROM gpitrack.task_labels tl JOIN gpitrack.labels l ON l.id = tl.label_id
      WHERE tl.task_id = t.id
    ) lbl ON true
    ORDER BY t.project_id, t.position ASC
  `);

  const { rows: membros } = await pool.query(`
    SELECT pm.project_id, u.name, u.email
    FROM gpitrack.project_members pm
    JOIN gpitrack.users u ON u.id = pm.user_id
    ORDER BY u.name
  `);

  const { rows: utilizadores } = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.is_active, u.created_at, u.last_seen_at,
           (SELECT COUNT(*)::int FROM gpitrack.tasks WHERE assignee_id = u.id) AS tarefas_atribuidas,
           (SELECT COUNT(*)::int FROM gpitrack.tasks WHERE created_by = u.id) AS tarefas_criadas,
           (SELECT COUNT(*)::int FROM gpitrack.comments WHERE user_id = u.id) AS total_comentarios,
           (SELECT COUNT(*)::int FROM gpitrack.project_members WHERE user_id = u.id) AS total_projetos
    FROM gpitrack.users u
    ORDER BY u.created_at ASC
  `);

  // Agrupar tarefas e membros por projeto
  const projetosCompletos = projetos.map((p) => ({
    ...p,
    tarefas: tarefas.filter((t) => t.project_id === p.id),
    membros: membros.filter((m) => m.project_id === p.id),
  }));

  return { projetos: projetosCompletos, utilizadores, geradoEm: new Date() };
}

module.exports = { obterDadosRelatorio };
