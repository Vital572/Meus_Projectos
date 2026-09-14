const express = require("express");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");
const { notificar } = require("../lib/notify");
const { ehDonoDoProjetoOuAdmin } = require("../lib/permissions");

const router = express.Router();
router.use(autenticar);

// GET /api/comments/tarefa/:taskId — lista comentários de uma tarefa
router.get("/tarefa/:taskId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.content, c.created_at, u.id AS user_id, u.name AS user_name, u.avatar_color
       FROM gpitrack.comments c
       JOIN gpitrack.users u ON u.id = c.user_id
       WHERE c.task_id = $1
       ORDER BY c.created_at ASC`,
      [req.params.taskId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter comentários." });
  }
});

// POST /api/comments — cria um comentário, notifica o responsável e utilizadores mencionados (@nome)
router.post("/", async (req, res) => {
  const { task_id, content } = req.body;
  if (!task_id || !content) return res.status(400).json({ erro: "task_id e content são obrigatórios." });

  try {
    const { rows: taskRows } = await pool.query(
      `SELECT project_id, assignee_id, title FROM gpitrack.tasks WHERE id = $1`,
      [task_id]
    );
    if (taskRows.length === 0) return res.status(404).json({ erro: "Tarefa não encontrada." });
    const { project_id: projectId, assignee_id: assigneeId, title } = taskRows[0];

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.comments (task_id, user_id, content) VALUES ($1, $2, $3)
       RETURNING id, task_id, content, created_at`,
      [task_id, req.user.id, content]
    );
    const comment = { ...rows[0], user_id: req.user.id, user_name: req.user.name };

    await pool.query(
      `INSERT INTO gpitrack.activity_log (project_id, user_id, action, details)
       VALUES ($1, $2, 'comment.created', $3)`,
      [projectId, req.user.id, JSON.stringify({ taskId: task_id })]
    );

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("comment:created", { comment });

    // Notifica o responsável pela tarefa (se não for o próprio autor do comentário)
    if (assigneeId && assigneeId !== req.user.id) {
      await notificar(io, {
        userId: assigneeId,
        type: "comment.new",
        content: `${req.user.name} comentou na tarefa "${title}".`,
        projectId, taskId: task_id,
      });
    }

    // Deteta menções simples do tipo @Nome dentro do texto do comentário
    const mencoes = [...content.matchAll(/@(\w+)/g)].map((m) => m[1].toLowerCase());
    if (mencoes.length > 0) {
      const { rows: membros } = await pool.query(
        `SELECT u.id, u.name FROM gpitrack.project_members pm
         JOIN gpitrack.users u ON u.id = pm.user_id WHERE pm.project_id = $1 AND pm.status = 'ativo'`,
        [projectId]
      );
      for (const membro of membros) {
        const primeiroNome = membro.name.split(" ")[0].toLowerCase();
        if (mencoes.includes(primeiroNome) && membro.id !== req.user.id && membro.id !== assigneeId) {
          await notificar(io, {
            userId: membro.id,
            type: "mention",
            content: `${req.user.name} mencionou-o(a) num comentário em "${title}".`,
            projectId, taskId: task_id,
          });
        }
      }
    }

    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar comentário." });
  }
});

// DELETE /api/comments/:id — elimina um comentário (autor do comentário, dono do projeto, ou administrador)
router.delete("/:id", async (req, res) => {
  try {
    const { rows: comentarioRows } = await pool.query(
      `SELECT c.id, c.user_id, c.task_id, t.project_id
       FROM gpitrack.comments c JOIN gpitrack.tasks t ON t.id = c.task_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    const comentario = comentarioRows[0];
    if (!comentario) return res.status(404).json({ erro: "Comentário não encontrado." });

    const podeEliminar = comentario.user_id === req.user.id || (await ehDonoDoProjetoOuAdmin(req.user, comentario.project_id));
    if (!podeEliminar) return res.status(403).json({ erro: "Sem permissão para eliminar este comentário." });

    await pool.query(`DELETE FROM gpitrack.comments WHERE id = $1`, [req.params.id]);

    const io = req.app.get("io");
    io.to(`project:${comentario.project_id}`).emit("comment:deleted", { commentId: comentario.id, taskId: comentario.task_id });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar comentário." });
  }
});

module.exports = router;
