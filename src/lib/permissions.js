const pool = require("../../db/pool");

/** Devolve o projeto (id, created_by) ou null se não existir. */
async function obterProjeto(projectId) {
  const { rows } = await pool.query(
    `SELECT id, created_by, name FROM gpitrack.projects WHERE id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

/**
 * true se o utilizador é responsável do projeto (pode ser mais do que um —
 * ver project_members.role) OU administrador da plataforma. O criador
 * original (projects.created_by) conta sempre como responsável, mesmo que
 * por alguma razão a linha em project_members não tenha sido marcada.
 */
async function ehDonoDoProjetoOuAdmin(user, projectId) {
  if (user.role === "admin") return true;
  const projeto = await obterProjeto(projectId);
  if (!projeto) return false;
  if (projeto.created_by === user.id) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND role = 'responsavel' AND status = 'ativo'`,
    [projectId, user.id]
  );
  return rows.length > 0;
}

/** Devolve a tarefa (id, project_id, created_by) ou null se não existir. */
async function obterTarefa(taskId) {
  const { rows } = await pool.query(
    `SELECT id, project_id, created_by, title FROM gpitrack.tasks WHERE id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

/**
 * true se o utilizador pode editar/eliminar a tarefa:
 * quem criou a tarefa, um responsável do projeto, ou um administrador da plataforma.
 */
async function podeGerirTarefa(user, tarefa) {
  if (user.role === "admin") return true;
  if (tarefa.created_by === user.id) return true;
  return ehDonoDoProjetoOuAdmin(user, tarefa.project_id);
}

/** true se o utilizador é membro do projeto (ou o dono, ou administrador da plataforma). */
async function ehMembroDoProjeto(user, projectId) {
  if (user.role === "admin") return true;
  const projeto = await obterProjeto(projectId);
  if (!projeto) return false;
  if (projeto.created_by === user.id) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'ativo'`,
    [projectId, user.id]
  );
  return rows.length > 0;
}

module.exports = { obterProjeto, ehDonoDoProjetoOuAdmin, obterTarefa, podeGerirTarefa, ehMembroDoProjeto };
