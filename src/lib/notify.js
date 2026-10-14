const pool = require("../../db/pool");
const { enviarEmailNotificacao, emailAtivo } = require("./email");

/**
 * Cria uma notificação na base de dados e transmite-a instantaneamente
 * ao utilizador-alvo (se este estiver ligado), através da sua sala pessoal
 * "user:<id>". Se o e-mail (Gmail) estiver configurado e o utilizador não
 * tiver desativado as notificações por e-mail, envia também um e-mail.
 *
 * EMAIL_APENAS_OFFLINE=true (no .env) envia e-mail só a quem NÃO está ligado
 * à plataforma nesse momento — evita duplicar o que o sino já mostra.
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

  // Em segundo plano: uma falha de e-mail nunca atrasa nem parte a notificação.
  if (emailAtivo()) enviarPorEmail(userId, notificacao).catch((e) => console.error("[notify] e-mail:", e.message));

  return notificacao;
}

async function enviarPorEmail(userId, n) {
  if (process.env.EMAIL_APENAS_OFFLINE === "true") {
    const { estaUtilizadorLigado } = require("../sockets"); // import tardio: evita dependência circular
    if (estaUtilizadorLigado(userId)) return;
  }
  const { rows } = await pool.query(
    `SELECT name, email, email_notificacoes, is_active FROM gpitrack.users WHERE id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u || !u.is_active || !u.email_notificacoes) return;
  await enviarEmailNotificacao({
    nome: u.name,
    email: u.email,
    tipo: n.type,
    conteudo: n.content,
    projectId: n.project_id,
    taskId: n.task_id,
  });
}

module.exports = { notificar };
