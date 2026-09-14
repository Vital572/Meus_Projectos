const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");
const { obterTarefa, podeGerirTarefa, obterProjeto, ehMembroDoProjeto, ehDonoDoProjetoOuAdmin } = require("../lib/permissions");
const { notificar } = require("../lib/notify");

const router = express.Router();
router.use(autenticar);

// ------------------------------------------------------------
// Upload de anexos — ficheiros gravados em /uploads/task-attachments,
// com um nome único em disco (o nome original fica guardado na BD).
// ------------------------------------------------------------
const PASTA_ANEXOS = path.join(__dirname, "..", "..", "uploads", "task-attachments");
fs.mkdirSync(PASTA_ANEXOS, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PASTA_ANEXOS),
    filename: (req, file, cb) => {
      const nomeUnico = `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
      cb(null, nomeUnico);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

async function registarAtividade(client, projectId, userId, action, details) {
  await client.query(
    `INSERT INTO gpitrack.activity_log (project_id, user_id, action, details)
     VALUES ($1, $2, $3, $4)`,
    [projectId, userId, action, JSON.stringify(details)]
  );
}

// POST /api/tasks — cria uma tarefa e notifica a equipa em tempo real
router.post("/", async (req, res) => {
  const { project_id, column_id, title, description, priority, assignee_id, due_date } = req.body;
  if (!project_id || !column_id || !title) {
    return res.status(400).json({ erro: "project_id, column_id e title são obrigatórios." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: posRows } = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM gpitrack.tasks WHERE column_id = $1`,
      [column_id]
    );
    const { rows } = await client.query(
      `INSERT INTO gpitrack.tasks
         (project_id, column_id, title, description, priority, assignee_id, due_date, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, project_id, column_id, title, description, priority, assignee_id, due_date, position, created_at, updated_at`,
      [project_id, column_id, title, description || null, priority || "media", assignee_id || null, due_date || null, posRows[0].pos, req.user.id]
    );
    const task = rows[0];
    await registarAtividade(client, project_id, req.user.id, "task.created", { taskId: task.id, title });
    await client.query("COMMIT");

    const io = req.app.get("io");
    io.to(`project:${project_id}`).emit("task:created", { task, autor: req.user.name });

    if (assignee_id && assignee_id !== req.user.id) {
      await notificar(io, {
        userId: assignee_id,
        type: "task.assigned",
        content: `${req.user.name} atribuiu-lhe a tarefa "${title}".`,
        projectId: project_id,
        taskId: task.id,
      });
    }

    res.status(201).json(task);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar tarefa." });
  } finally {
    client.release();
  }
});

// PATCH /api/tasks/:id — edita campos da tarefa (apenas quem criou a tarefa, o dono do projeto, ou um administrador)
router.patch("/:id", async (req, res) => {
  const { id } = req.params;

  const tarefaAtual = await obterTarefa(id);
  if (!tarefaAtual) return res.status(404).json({ erro: "Tarefa não encontrada." });
  if (!(await podeGerirTarefa(req.user, tarefaAtual))) {
    return res.status(403).json({ erro: "Apenas quem criou a tarefa, o dono do projeto ou um administrador pode editá-la." });
  }

  const campos = ["title", "description", "priority", "assignee_id", "due_date"];
  const updates = [];
  const valores = [];
  campos.forEach((campo) => {
    if (req.body[campo] !== undefined) {
      updates.push(`${campo} = $${updates.length + 1}`);
      valores.push(req.body[campo]);
    }
  });
  if (updates.length === 0) return res.status(400).json({ erro: "Nada para atualizar." });

  try {
    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE gpitrack.tasks SET ${updates.join(", ")} WHERE id = $${valores.length}
       RETURNING id, project_id, column_id, title, description, priority, assignee_id, due_date, position, updated_at`,
      valores
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ erro: "Tarefa não encontrada." });

    await pool.query(
      `INSERT INTO gpitrack.activity_log (project_id, user_id, action, details)
       VALUES ($1, $2, 'task.updated', $3)`,
      [task.project_id, req.user.id, JSON.stringify({ taskId: task.id, campos: Object.keys(req.body) })]
    );

    const io = req.app.get("io");
    io.to(`project:${task.project_id}`).emit("task:updated", { task, autor: req.user.name });

    if (req.body.assignee_id && req.body.assignee_id !== req.user.id) {
      const { notificar } = require("../lib/notify");
      await notificar(io, {
        userId: req.body.assignee_id,
        type: "task.assigned",
        content: `${req.user.name} atribuiu-lhe a tarefa "${task.title}".`,
        projectId: task.project_id,
        taskId: task.id,
      });
    }

    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar tarefa." });
  }
});

// PATCH /api/tasks/:id/mover — move a tarefa entre colunas (drag-and-drop do quadro Kanban)
router.patch("/:id/mover", async (req, res) => {
  const { id } = req.params;
  const { column_id, position } = req.body;
  if (!column_id || position === undefined) {
    return res.status(400).json({ erro: "column_id e position são obrigatórios." });
  }
  try {
    const tarefaAtual = await obterTarefa(id);
    if (!tarefaAtual) return res.status(404).json({ erro: "Tarefa não encontrada." });

    // Só responsáveis do projeto (ou administradores) podem mover tarefas entre
    // colunas — os restantes membros só trabalham nas tarefas que lhes foram atribuídas.
    const podeMover = await ehDonoDoProjetoOuAdmin(req.user, tarefaAtual.project_id);
    if (!podeMover) return res.status(403).json({ erro: "Só um responsável do projeto (ou administrador) pode mover tarefas." });

    const { rows: colRows } = await pool.query(`SELECT restricted FROM gpitrack.board_columns WHERE id = $1`, [column_id]);
    if (colRows.length === 0) return res.status(404).json({ erro: "Coluna de destino não encontrada." });

    const { rows } = await pool.query(
      `UPDATE gpitrack.tasks SET column_id = $1, position = $2 WHERE id = $3
       RETURNING id, project_id, column_id, position, title`,
      [column_id, position, id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ erro: "Tarefa não encontrada." });

    await pool.query(
      `INSERT INTO gpitrack.activity_log (project_id, user_id, action, details)
       VALUES ($1, $2, 'task.moved', $3)`,
      [task.project_id, req.user.id, JSON.stringify({ taskId: task.id, para: column_id })]
    );

    const io = req.app.get("io");
    io.to(`project:${task.project_id}`).emit("task:moved", { task, autor: req.user.name });

    // Automações simples: "quando uma tarefa entra nesta coluna, notifica X"
    await executarAutomacoes(io, task, req.user);

    res.json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao mover tarefa." });
  }
});

async function executarAutomacoes(io, task, autor) {
  const { rows: regras } = await pool.query(
    `SELECT a.*, p.created_by AS dono_projeto
     FROM gpitrack.automations a
     JOIN gpitrack.projects p ON p.id = a.project_id
     WHERE a.project_id = $1 AND a.trigger_column_id = $2 AND a.active = true`,
    [task.project_id, task.column_id]
  );

  for (const regra of regras) {
    if (regra.action_type === "atribuir" && regra.assign_user_id) {
      await pool.query(`UPDATE gpitrack.tasks SET assignee_id = $1 WHERE id = $2`, [regra.assign_user_id, task.id]);
      if (regra.assign_user_id !== autor.id) {
        await notificar(io, {
          userId: regra.assign_user_id,
          type: "automation.triggered",
          content: `Automação "${regra.name}": foi-lhe atribuída a tarefa "${task.title}".`,
          projectId: task.project_id,
          taskId: task.id,
        });
      }
      io.to(`project:${task.project_id}`).emit("task:updated", { task: { ...task, assignee_id: regra.assign_user_id } });
    } else if (regra.action_type === "definir_prioridade" && regra.set_priority) {
      await pool.query(`UPDATE gpitrack.tasks SET priority = $1 WHERE id = $2`, [regra.set_priority, task.id]);
      io.to(`project:${task.project_id}`).emit("task:updated", { task: { ...task, priority: regra.set_priority } });
    } else if (regra.action_type === "concluir_checklist") {
      await pool.query(`UPDATE gpitrack.checklist_items SET is_done = true WHERE task_id = $1`, [task.id]);
      io.to(`project:${task.project_id}`).emit("checklist:auto-concluida", { taskId: task.id });
    } else {
      // 'notificar' (omissão)
      const destinatario = regra.notify_user_id || regra.dono_projeto;
      if (!destinatario || destinatario === autor.id) continue;
      await notificar(io, {
        userId: destinatario,
        type: "automation.triggered",
        content: `Automação "${regra.name}": ${autor.name} moveu a tarefa "${task.title}".`,
        projectId: task.project_id,
        taskId: task.id,
      });
    }
  }
}

// DELETE /api/tasks/:id — elimina a tarefa (apenas quem a criou, o dono do projeto, ou um administrador)
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  const tarefaAtual = await obterTarefa(id);
  if (!tarefaAtual) return res.status(404).json({ erro: "Tarefa não encontrada." });
  if (!(await podeGerirTarefa(req.user, tarefaAtual))) {
    return res.status(403).json({ erro: "Apenas quem criou a tarefa, o dono do projeto ou um administrador pode eliminá-la." });
  }

  try {
    const { rows } = await pool.query(
      `DELETE FROM gpitrack.tasks WHERE id = $1 RETURNING id, project_id, title`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ erro: "Tarefa não encontrada." });

    const io = req.app.get("io");
    io.to(`project:${task.project_id}`).emit("task:deleted", { taskId: task.id, autor: req.user.name });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar tarefa." });
  }
});

// PUT /api/tasks/:id/etiquetas — define o conjunto de etiquetas da tarefa
router.put("/:id/etiquetas", async (req, res) => {
  const { id } = req.params;
  const { label_ids } = req.body; // array de UUIDs
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM gpitrack.task_labels WHERE task_id = $1`, [id]);
    for (const labelId of label_ids || []) {
      await client.query(
        `INSERT INTO gpitrack.task_labels (task_id, label_id) VALUES ($1, $2)`,
        [id, labelId]
      );
    }
    const { rows: taskRows } = await client.query(`SELECT project_id FROM gpitrack.tasks WHERE id = $1`, [id]);
    await client.query("COMMIT");

    const { rows: labelRows } = await pool.query(
      `SELECT l.id, l.name, l.color FROM gpitrack.task_labels tl
       JOIN gpitrack.labels l ON l.id = tl.label_id WHERE tl.task_id = $1`,
      [id]
    );

    const io = req.app.get("io");
    io.to(`project:${taskRows[0].project_id}`).emit("task:labels", { taskId: id, labels: labelRows });

    res.json(labelRows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar etiquetas." });
  } finally {
    client.release();
  }
});

// GET /api/tasks/:id/checklist
router.get("/:id/checklist", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, content, is_done, position FROM gpitrack.checklist_items
       WHERE task_id = $1 ORDER BY position ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter checklist." });
  }
});

// POST /api/tasks/:id/checklist — adiciona um item à checklist
router.post("/:id/checklist", async (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ erro: "O texto do item é obrigatório." });
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });

    const podeCriar = await ehDonoDoProjetoOuAdmin(req.user, tarefa.project_id);
    if (!podeCriar) return res.status(403).json({ erro: "Só responsáveis do projeto ou administradores podem criar itens de checklist." });

    const { rows: posRows } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM gpitrack.checklist_items WHERE task_id = $1`,
      [req.params.id]
    );
    const { rows } = await pool.query(
      `INSERT INTO gpitrack.checklist_items (task_id, content, position) VALUES ($1, $2, $3)
       RETURNING id, content, is_done, position`,
      [req.params.id, content, posRows[0].pos]
    );

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("checklist:item-created", { taskId: req.params.id, item: rows[0] });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao adicionar item à checklist." });
  }
});

// PATCH /api/tasks/checklist/:itemId — marca/desmarca um item
router.patch("/checklist/:itemId", async (req, res) => {
  const { is_done } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE gpitrack.checklist_items SET is_done = $1 WHERE id = $2
       RETURNING id, task_id, content, is_done, position`,
      [is_done, req.params.itemId]
    );
    const item = rows[0];
    if (!item) return res.status(404).json({ erro: "Item não encontrado." });

    const { rows: taskRows } = await pool.query(`SELECT project_id FROM gpitrack.tasks WHERE id = $1`, [item.task_id]);
    const io = req.app.get("io");
    io.to(`project:${taskRows[0].project_id}`).emit("checklist:item-updated", { taskId: item.task_id, item });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar item." });
  }
});

// DELETE /api/tasks/checklist/:itemId
router.delete("/checklist/:itemId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM gpitrack.checklist_items WHERE id = $1 RETURNING id, task_id`,
      [req.params.itemId]
    );
    const item = rows[0];
    if (!item) return res.status(404).json({ erro: "Item não encontrado." });

    const { rows: taskRows } = await pool.query(`SELECT project_id FROM gpitrack.tasks WHERE id = $1`, [item.task_id]);
    const io = req.app.get("io");
    io.to(`project:${taskRows[0].project_id}`).emit("checklist:item-deleted", { taskId: item.task_id, itemId: item.id });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover item." });
  }
});

// GET /api/tasks/:id/anexos — lista os ficheiros já enviados nesta tarefa
router.get("/:id/anexos", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.file_name, a.file_size, a.mime_type, a.created_at,
              u.name AS enviado_por_nome,
              d.name AS enviado_para_nome
       FROM gpitrack.task_attachments a
       JOIN gpitrack.users u ON u.id = a.uploaded_by
       LEFT JOIN gpitrack.users d ON d.id = a.sent_to
       WHERE a.task_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter anexos." });
  }
});

// POST /api/tasks/:id/anexos — anexa um ficheiro e envia-o de imediato
// ao responsável (criador) do projeto, notificando-o em tempo real.
router.post("/:id/anexos", upload.single("ficheiro"), async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    const podeEnviar = await ehMembroDoProjeto(req.user, tarefa.project_id);
    if (!podeEnviar) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ erro: "Sem permissão para enviar ficheiros nesta tarefa." });
    }

    if (!req.file) {
      return res.status(400).json({ erro: "Selecione um ficheiro para enviar." });
    }

    const projeto = await obterProjeto(tarefa.project_id);
    const { rows: responsaveisAtivos } = await pool.query(
      `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
      [tarefa.project_id]
    );
    if (!projeto || responsaveisAtivos.length === 0) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ erro: "Este projeto não tem nenhum responsável definido." });
    }
    const responsavelPrincipal = responsaveisAtivos[0].user_id;

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.task_attachments
         (task_id, project_id, uploaded_by, sent_to, file_name, stored_name, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, file_name, file_size, mime_type, created_at`,
      [req.params.id, tarefa.project_id, req.user.id, responsavelPrincipal, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype]
    );
    const anexo = { ...rows[0], enviado_por_nome: req.user.name, enviado_para_nome: null };

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("attachment:created", { taskId: req.params.id, anexo });

    for (const r of responsaveisAtivos) {
      if (r.user_id === req.user.id) continue;
      await notificar(io, {
        userId: r.user_id,
        type: "task.file_sent",
        content: `${req.user.name} enviou-lhe o ficheiro "${req.file.originalname}" na tarefa "${tarefa.title}".`,
        projectId: tarefa.project_id,
        taskId: req.params.id,
      });
    }

    res.status(201).json(anexo);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error(err);
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ erro: "O ficheiro excede o limite de 15 MB." });
    }
    res.status(500).json({ erro: "Erro ao enviar o ficheiro." });
  }
});

// GET /api/tasks/anexos/:anexoId/download — descarrega um anexo
// (apenas membros do projeto correspondente)
router.get("/anexos/:anexoId/download", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, project_id, file_name, stored_name, mime_type FROM gpitrack.task_attachments WHERE id = $1`,
      [req.params.anexoId]
    );
    const anexo = rows[0];
    if (!anexo) return res.status(404).json({ erro: "Anexo não encontrado." });

    const podeVer = await ehMembroDoProjeto(req.user, anexo.project_id);
    if (!podeVer) return res.status(403).json({ erro: "Sem permissão para aceder a este ficheiro." });

    const caminho = path.join(PASTA_ANEXOS, anexo.stored_name);
    if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "O ficheiro já não existe no servidor." });

    res.download(caminho, anexo.file_name);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao descarregar o anexo." });
  }
});

// GET /api/tasks/:id/responsaveis — responsáveis extra da tarefa (além do principal)
router.get("/:id/responsaveis", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_color
       FROM gpitrack.task_responsibles tr
       JOIN gpitrack.users u ON u.id = tr.user_id
       WHERE tr.task_id = $1
       ORDER BY u.name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter responsáveis." });
  }
});

// POST /api/tasks/:id/responsaveis — adiciona um responsável extra
// (só responsáveis do projeto ou administradores)
router.post("/:id/responsaveis", async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ erro: "Escolha a pessoa a adicionar." });

  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });

    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, tarefa.project_id);
    if (!autorizado) return res.status(403).json({ erro: "Só responsáveis do projeto ou administradores podem gerir responsáveis da tarefa." });

    const podeSerResponsavel = await ehMembroDoProjeto({ id: user_id, role: "member" }, tarefa.project_id);
    if (!podeSerResponsavel) return res.status(400).json({ erro: "Essa pessoa não é membro deste projeto." });

    await pool.query(
      `INSERT INTO gpitrack.task_responsibles (task_id, user_id, added_by) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [req.params.id, user_id, req.user.id]
    );

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:responsible-added", { taskId: req.params.id, userId: user_id });
    if (user_id !== req.user.id) {
      await notificar(io, {
        userId: user_id,
        type: "task.made_responsible",
        content: `${req.user.name} tornou-o(a) responsável pela tarefa "${tarefa.title}".`,
        projectId: tarefa.project_id,
        taskId: req.params.id,
      });
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao adicionar responsável." });
  }
});

// DELETE /api/tasks/:id/responsaveis/:userId
router.delete("/:id/responsaveis/:userId", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });

    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, tarefa.project_id);
    if (!autorizado) return res.status(403).json({ erro: "Só responsáveis do projeto ou administradores podem gerir responsáveis da tarefa." });

    await pool.query(`DELETE FROM gpitrack.task_responsibles WHERE task_id = $1 AND user_id = $2`, [req.params.id, req.params.userId]);

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:responsible-removed", { taskId: req.params.id, userId: req.params.userId });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover responsável." });
  }
});

module.exports = router;
