/**
 * Registo de tempo automático.
 *
 * Regras:
 *  - O tempo NUNCA conta em colunas "concluídas" (is_done) nem em colunas
 *    protegidas/restritas (restricted).
 *  - Só começa sozinho quando a tarefa está numa coluna marcada pelo responsável
 *    do projeto como "inicia o registo de tempo" (timer_start), ou quando uma
 *    automação "iniciar registo de tempo" dispara. Conta para o responsável
 *    (atribuído) da tarefa.
 *  - Ao entrar numa coluna concluída/protegida, os cronómetros dessa tarefa param.
 */
const pool = require("../../db/pool");
const { notificar } = require("./notify");

const MSG_AUTOMATICA = "Nesta coluna o registo de tempo é automático: não pode ser iniciado nem reiniciado à mão.";
const MSG_BLOQUEADA = "O registo de tempo não conta em colunas protegidas nem em colunas concluídas.";

async function colunaDaTarefa(taskId) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.project_id, t.assignee_id, c.id AS column_id, c.is_done, c.restricted, c.timer_start
     FROM gpitrack.tasks t JOIN gpitrack.board_columns c ON c.id = t.column_id WHERE t.id = $1`,
    [taskId]
  );
  return rows[0] || null;
}

const colunaBloqueada = (t) => !!t && (t.is_done || t.restricted);

// Para todos os cronómetros a correr de uma tarefa (ou de todas as tarefas de uma coluna)
async function pararCronometros(io, { taskId = null, columnId = null }) {
  const { rows } = await pool.query(
    `UPDATE gpitrack.time_entries e
        SET ended_at = now(), seconds = EXTRACT(EPOCH FROM (now() - e.started_at))::int
      FROM gpitrack.tasks t
      WHERE e.task_id = t.id AND e.ended_at IS NULL
        AND ($1::uuid IS NULL OR t.id = $1) AND ($2::uuid IS NULL OR t.column_id = $2)
      RETURNING e.task_id, e.user_id, e.seconds, t.project_id`,
    [taskId, columnId]
  );
  for (const r of rows) {
    io.to(`project:${r.project_id}`).emit("task:tempo-registado", { taskId: r.task_id, userId: r.user_id, seconds: r.seconds });
    io.to(`user:${r.user_id}`).emit("tempo:parado", { taskId: r.task_id });
  }
  return rows.length;
}

// Começa a contar para o responsável da tarefa, se a coluna o permitir.
// `forcar` = true ignora a marca "inicia registo de tempo" da coluna (usado pela automação).
async function iniciarTempoAutomatico(io, taskId, { forcar = false } = {}) {
  const t = await colunaDaTarefa(taskId);
  if (!t || !t.assignee_id || colunaBloqueada(t)) return false;
  if (!forcar && !t.timer_start) return false;

  const { rows: jaCorre } = await pool.query(
    `SELECT 1 FROM gpitrack.time_entries WHERE task_id = $1 AND user_id = $2 AND ended_at IS NULL`,
    [taskId, t.assignee_id]
  );
  if (jaCorre.length) return false;
  try {
    await pool.query(
      `INSERT INTO gpitrack.time_entries (task_id, user_id, started_at) VALUES ($1, $2, now())`,
      [taskId, t.assignee_id]
    );
  } catch (err) {
    if (err.code === "23505") {
      // Só pode haver um cronómetro a correr por pessoa
      await notificar(io, {
        userId: t.assignee_id,
        type: "automation.triggered",
        content: `A tarefa "${t.title}" devia começar a contar tempo, mas já tem um cronómetro a correr noutra tarefa. Pare-o e inicie este manualmente.`,
        projectId: t.project_id,
        taskId: t.id,
      });
      return false;
    }
    throw err;
  }
  io.to(`user:${t.assignee_id}`).emit("tempo:iniciado", { taskId });
  io.to(`project:${t.project_id}`).emit("task:tempo-registado", { taskId, userId: t.assignee_id, seconds: null });
  return true;
}

// Coluna passou a "iniciar registo de tempo": arranca para as tarefas que já lá estavam (com responsável)
async function iniciarTempoDaColuna(io, columnId) {
  const { rows } = await pool.query(`SELECT id FROM gpitrack.tasks WHERE column_id = $1 AND assignee_id IS NOT NULL AND parent_task_id IS NULL`, [columnId]);
  let n = 0;
  for (const r of rows) if (await iniciarTempoAutomatico(io, r.id)) n++;
  return n;
}

module.exports = { MSG_AUTOMATICA, iniciarTempoDaColuna, MSG_BLOQUEADA, colunaDaTarefa, colunaBloqueada, pararCronometros, iniciarTempoAutomatico };
