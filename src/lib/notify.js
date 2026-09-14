const pool = require("../../db/pool");

/**
 * Cria uma notificação na base de dados e transmite-a instantaneamente
 * ao utilizador-alvo (se este estiver ligado), através da sua sala pessoal
 * "user:<id>".
 */
async function notificar(io, { userId, type, content, projectId = null, taskId = null }) {
  if (!userId) return;
  const { rows } = await pool.query(
    `INSERT INTO gpitrack.notifications (user_id, type, content, project_id, task_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, type, content, project_id, task_id, is_read, created_at`,
    [userId, type, content, projectId, taskId]
  );
  const notificacao = rows[0];
  io.to(`user:${userId}`).emit("notification:new", notificacao);
  return notificacao;
}

module.exports = { notificar };
