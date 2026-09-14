const pool = require("../../db/pool");
const { notificar } = require("./notify");

/**
 * Notifica quem está atribuído a uma tarefa: 1 dia antes do prazo, e no
 * próprio dia do prazo. Cada tarefa só é lembrada uma vez em cada um dos
 * dois momentos (colunas reminded_day_before / reminded_due_day), para não
 * repetir a notificação sempre que este verificador correr.
 */
async function verificarPrazosDeTarefas(io) {
  const resultado = { avisadas_amanha: 0, avisadas_hoje: 0 };

  async function destinatariosDaTarefa(taskId, assigneeId) {
    const { rows } = await pool.query(`SELECT user_id FROM gpitrack.task_responsibles WHERE task_id = $1`, [taskId]);
    const ids = new Set(rows.map((r) => r.user_id));
    if (assigneeId) ids.add(assigneeId);
    return [...ids];
  }

  const amanha = await pool.query(
    `SELECT t.id, t.title, t.project_id, t.assignee_id
     FROM gpitrack.tasks t
     WHERE t.reminded_day_before = false
       AND t.due_date::date = (now() + interval '1 day')::date`
  );
  for (const t of amanha.rows) {
    const destinatarios = await destinatariosDaTarefa(t.id, t.assignee_id);
    for (const userId of destinatarios) {
      await notificar(io, {
        userId,
        type: "task.due_tomorrow",
        content: `A tarefa "${t.title}" tem prazo amanhã.`,
        projectId: t.project_id,
        taskId: t.id,
      });
    }
    if (destinatarios.length > 0) {
      await pool.query(`UPDATE gpitrack.tasks SET reminded_day_before = true WHERE id = $1`, [t.id]);
      resultado.avisadas_amanha++;
    }
  }

  const hoje = await pool.query(
    `SELECT t.id, t.title, t.project_id, t.assignee_id
     FROM gpitrack.tasks t
     WHERE t.reminded_due_day = false
       AND t.due_date::date = now()::date`
  );
  for (const t of hoje.rows) {
    const destinatarios = await destinatariosDaTarefa(t.id, t.assignee_id);
    for (const userId of destinatarios) {
      await notificar(io, {
        userId,
        type: "task.due_today",
        content: `A tarefa "${t.title}" tem prazo hoje.`,
        projectId: t.project_id,
        taskId: t.id,
      });
    }
    if (destinatarios.length > 0) {
      await pool.query(`UPDATE gpitrack.tasks SET reminded_due_day = true WHERE id = $1`, [t.id]);
      resultado.avisadas_hoje++;
    }
  }

  return resultado;
}

module.exports = { verificarPrazosDeTarefas };
