const express = require("express");
const multer = require("multer");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");
const { obterTarefa, podeGerirTarefa, obterProjeto, ehMembroDoProjeto, ehDonoDoProjetoOuAdmin, podeVerTarefa, podeInteragirComTarefa } = require("../lib/permissions");
const { notificar } = require("../lib/notify");
const storage = require("../lib/storage");

const router = express.Router();
router.use(autenticar);

// ------------------------------------------------------------
// Upload de anexos — o ficheiro é recebido em memória, validado, e só depois
// guardado (Supabase Storage online / pasta /uploads em desenvolvimento) com
// um nome único. O nome original fica guardado na BD.
// ------------------------------------------------------------
const PASTA_ANEXOS = storage.PASTAS.ANEXOS;

const upload = multer({
  storage: multer.memoryStorage(),
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
// Devolve os ids dos utilizadores autorizados a ver uma tarefa restrita:
// responsáveis do projeto + o atribuído à tarefa (os administradores recebem
// o evento à parte, pela sala "admins").
async function obterDestinatariosTarefaRestrita(projectId, assigneeId) {
  const { rows } = await pool.query(
    `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
    [projectId]
  );
  const ids = new Set(rows.map((r) => r.user_id));
  if (assigneeId) ids.add(assigneeId);
  return [...ids];
}

function emitirParaTarefa(io, task, evento, payload) {
  if (task.visibility === "restrita") {
    io.to("admins").emit(evento, payload);
    obterDestinatariosTarefaRestrita(task.project_id, task.assignee_id).then((ids) => {
      ids.forEach((userId) => io.to(`user:${userId}`).emit(evento, payload));
    });
  } else {
    io.to(`project:${task.project_id}`).emit(evento, payload);
  }
}

router.post("/", async (req, res) => {
  const { project_id, column_id, title, description, priority, assignee_id, due_date, start_date, visibility, parent_task_id } = req.body;
  if (!project_id || !column_id || !title) {
    return res.status(400).json({ erro: "project_id, column_id e title são obrigatórios." });
  }
  const visibilidade = visibility === "restrita" ? "restrita" : "equipa";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: posRows } = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM gpitrack.tasks WHERE column_id = $1`,
      [column_id]
    );
    const { rows } = await client.query(
      `INSERT INTO gpitrack.tasks
         (project_id, column_id, title, description, priority, assignee_id, due_date, start_date, position, created_by, visibility, parent_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, project_id, column_id, title, description, priority, assignee_id, due_date, start_date, position, created_at, updated_at, visibility, parent_task_id`,
      [project_id, column_id, title, description || null, priority || "media", assignee_id || null, due_date || null, start_date || null, posRows[0].pos, req.user.id, visibilidade, parent_task_id || null]
    );
    const task = rows[0];
    await registarAtividade(client, project_id, req.user.id, "task.created", { taskId: task.id, title });
    await client.query("COMMIT");

    const io = req.app.get("io");
    emitirParaTarefa(io, task, "task:created", { task, autor: req.user.name, autorId: req.user.id });

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

  const campos = ["title", "description", "priority", "assignee_id", "due_date", "start_date", "visibility", "parent_task_id"];
  const updates = [];
  const valores = [];
  campos.forEach((campo) => {
    if (req.body[campo] !== undefined) {
      if (campo === "visibility" && !["equipa", "restrita"].includes(req.body.visibility)) return;
      updates.push(`${campo} = $${updates.length + 1}`);
      valores.push(req.body[campo]);
    }
  });
  if (updates.length === 0) return res.status(400).json({ erro: "Nada para atualizar." });

  try {
    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE gpitrack.tasks SET ${updates.join(", ")} WHERE id = $${valores.length}
       RETURNING id, project_id, column_id, title, description, priority, assignee_id, due_date, start_date, position, updated_at, visibility, parent_task_id`,
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
    emitirParaTarefa(io, task, "task:updated", { task, autor: req.user.name, autorId: req.user.id });

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
       RETURNING id, project_id, column_id, position, title, visibility, assignee_id`,
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
    emitirParaTarefa(io, task, "task:moved", { task, autor: req.user.name, autorId: req.user.id });

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
    // Nomes dos ficheiros anexados à tarefa E às suas subtarefas (a BD apaga os
    // registos em cascata; os ficheiros em si são apagados do armazenamento a seguir).
    const { rows: anexos } = await pool.query(
      `WITH RECURSIVE arvore AS (
         SELECT id FROM gpitrack.tasks WHERE id = $1
         UNION ALL
         SELECT t.id FROM gpitrack.tasks t JOIN arvore a ON t.parent_task_id = a.id
       )
       SELECT stored_name FROM gpitrack.task_attachments WHERE task_id IN (SELECT id FROM arvore)`,
      [id]
    );
    const { rows } = await pool.query(
      `DELETE FROM gpitrack.tasks WHERE id = $1 RETURNING id, project_id, title`,
      [id]
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ erro: "Tarefa não encontrada." });
    storage.apagarVarios(PASTA_ANEXOS, anexos.map((a) => a.stored_name));

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
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

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
    io.to(`project:${tarefa.project_id}`).emit("checklist:item-created", { taskId: req.params.id, item: rows[0], autorId: req.user.id });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao adicionar item à checklist." });
  }
});

// PATCH /api/tasks/checklist/:itemId — marca/desmarca um item (só responsáveis
// do projeto ou administradores — um membro comum não pode marcar checklist)
router.patch("/checklist/:itemId", async (req, res) => {
  const { is_done } = req.body;
  try {
    const { rows: itemAtual } = await pool.query(`SELECT task_id FROM gpitrack.checklist_items WHERE id = $1`, [req.params.itemId]);
    if (itemAtual.length === 0) return res.status(404).json({ erro: "Item não encontrado." });

    const tarefa = await obterTarefa(itemAtual[0].task_id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    const podeMarcar = await ehDonoDoProjetoOuAdmin(req.user, tarefa.project_id);
    if (!podeMarcar) return res.status(403).json({ erro: "Só responsáveis do projeto ou administradores podem marcar itens da checklist." });

    const { rows } = await pool.query(
      `UPDATE gpitrack.checklist_items SET is_done = $1 WHERE id = $2
       RETURNING id, task_id, content, is_done, position`,
      [is_done, req.params.itemId]
    );
    const item = rows[0];

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("checklist:item-updated", { taskId: item.task_id, item });

    res.json(item);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar item." });
  }
});

// DELETE /api/tasks/checklist/:itemId — só responsáveis do projeto ou administradores
router.delete("/checklist/:itemId", async (req, res) => {
  try {
    const { rows: itemAtual } = await pool.query(`SELECT task_id FROM gpitrack.checklist_items WHERE id = $1`, [req.params.itemId]);
    if (itemAtual.length === 0) return res.status(404).json({ erro: "Item não encontrado." });

    const tarefa = await obterTarefa(itemAtual[0].task_id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    const podeRemover = await ehDonoDoProjetoOuAdmin(req.user, tarefa.project_id);
    if (!podeRemover) return res.status(403).json({ erro: "Só responsáveis do projeto ou administradores podem remover itens da checklist." });

    const { rows } = await pool.query(
      `DELETE FROM gpitrack.checklist_items WHERE id = $1 RETURNING id, task_id`,
      [req.params.itemId]
    );
    const item = rows[0];

    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("checklist:item-deleted", { taskId: item.task_id, itemId: item.id });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover item." });
  }
});

// GET /api/tasks/:id/anexos — lista os ficheiros já enviados nesta tarefa
router.get("/:id/anexos", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

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
  let nomeGuardado = null;
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) {
      return res.status(404).json({ erro: "Tarefa não encontrada." });
    }

    if (!(await podeVerTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Sem acesso a esta tarefa." });
    }
    // Ver a tarefa não chega: só quem está diretamente envolvido nela (o
    // atribuído, um responsável extra, um responsável do projeto, ou um
    // administrador) pode enviar ficheiros — os restantes só veem.
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode enviar ficheiros. Pode ver as informações, mas não interagir." });
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
      return res.status(400).json({ erro: "Este projeto não tem nenhum responsável definido." });
    }
    const responsavelPrincipal = responsaveisAtivos[0].user_id;

    // Só agora (já com as permissões validadas) o ficheiro é guardado.
    nomeGuardado = await storage.guardar(PASTA_ANEXOS, req.file.originalname, req.file.buffer, req.file.mimetype);

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.task_attachments
         (task_id, project_id, uploaded_by, sent_to, file_name, stored_name, file_size, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, file_name, file_size, mime_type, created_at`,
      [req.params.id, tarefa.project_id, req.user.id, responsavelPrincipal, req.file.originalname, nomeGuardado, req.file.size, req.file.mimetype]
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
    if (nomeGuardado) storage.apagar(PASTA_ANEXOS, nomeGuardado); // não deixa ficheiros "órfãos"
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

    const enviado = await storage.enviar(req, res, PASTA_ANEXOS, anexo.stored_name, {
      nomeDownload: anexo.file_name,
      mimetype: anexo.mime_type,
      comoAnexo: true,
    });
    if (!enviado) return res.status(404).json({ erro: "O ficheiro já não existe no servidor." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao descarregar o anexo." });
  }
});

// GET /api/tasks/:id/responsaveis — responsáveis extra da tarefa (além do principal)
router.get("/:id/responsaveis", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

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

// ---------------- Campos personalizados (valores por tarefa) ----------------

// GET /api/tasks/:id/campos — valores dos campos personalizados desta tarefa
router.get("/:id/campos", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

    const { rows } = await pool.query(
      `SELECT f.id AS field_id, f.name, f.type, f.options, v.value
       FROM gpitrack.project_custom_fields f
       LEFT JOIN gpitrack.task_custom_values v ON v.field_id = f.id AND v.task_id = $1
       WHERE f.project_id = $2 ORDER BY f.position`,
      [req.params.id, tarefa.project_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter campos personalizados." });
  }
});

// PUT /api/tasks/:id/campos/:fieldId — define/atualiza o valor de um campo personalizado nesta tarefa
router.put("/:id/campos/:fieldId", async (req, res) => {
  const { value } = req.body;
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode editar os seus campos." });
    }
    await pool.query(
      `INSERT INTO gpitrack.task_custom_values (task_id, field_id, value) VALUES ($1, $2, $3)
       ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value`,
      [req.params.id, req.params.fieldId, value ?? null]
    );
    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:campo-atualizado", { taskId: req.params.id, fieldId: req.params.fieldId, value: value ?? null });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao guardar o valor do campo." });
  }
});

// ---------------- Subtarefas (Asana) ----------------

// GET /api/tasks/:id/subtarefas
router.get("/:id/subtarefas", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.priority, t.due_date, c.is_done,
              u.id AS assignee_id, u.name AS assignee_name, u.avatar_color AS assignee_color
       FROM gpitrack.tasks t
       LEFT JOIN gpitrack.board_columns c ON c.id = t.column_id
       LEFT JOIN gpitrack.users u ON u.id = t.assignee_id
       WHERE t.parent_task_id = $1 ORDER BY t.position`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter subtarefas." });
  }
});

// POST /api/tasks/:id/subtarefas — cria uma subtarefa (na mesma coluna da tarefa-mãe)
router.post("/:id/subtarefas", async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ erro: "O título é obrigatório." });
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode adicionar subtarefas." });
    }
    const { rows: posRows } = await pool.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM gpitrack.tasks WHERE column_id = $1`,
      [tarefa.column_id]
    );
    const { rows } = await pool.query(
      `INSERT INTO gpitrack.tasks (project_id, column_id, title, position, created_by, parent_task_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, priority, due_date`,
      [tarefa.project_id, tarefa.column_id, title.trim(), posRows[0].pos, req.user.id, tarefa.id]
    );
    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:subtarefa-criada", { parentId: tarefa.id, subtarefa: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar subtarefa." });
  }
});

// ---------------- Dependências entre tarefas (Asana) ----------------

// GET /api/tasks/:id/dependencias — tarefas das quais esta depende, com o estado "concluída" de cada uma
router.get("/:id/dependencias", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

    const { rows } = await pool.query(
      `SELECT t.id, t.title, COALESCE(c.is_done, false) AS concluida
       FROM gpitrack.task_dependencies d
       JOIN gpitrack.tasks t ON t.id = d.depends_on_task_id
       LEFT JOIN gpitrack.board_columns c ON c.id = t.column_id
       WHERE d.task_id = $1 ORDER BY t.title`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter dependências." });
  }
});

// POST /api/tasks/:id/dependencias — adiciona "esta tarefa depende de depends_on_task_id"
router.post("/:id/dependencias", async (req, res) => {
  const { depends_on_task_id } = req.body;
  if (!depends_on_task_id) return res.status(400).json({ erro: "depends_on_task_id é obrigatório." });
  if (depends_on_task_id === req.params.id) return res.status(400).json({ erro: "Uma tarefa não pode depender de si própria." });
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode definir dependências." });
    }
    await pool.query(
      `INSERT INTO gpitrack.task_dependencies (task_id, depends_on_task_id, created_by)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [req.params.id, depends_on_task_id, req.user.id]
    );
    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:dependencia-criada", { taskId: req.params.id, dependsOnTaskId: depends_on_task_id });
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao adicionar dependência." });
  }
});

// DELETE /api/tasks/:id/dependencias/:dependsOnId
router.delete("/:id/dependencias/:dependsOnId", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode remover dependências." });
    }
    await pool.query(
      `DELETE FROM gpitrack.task_dependencies WHERE task_id = $1 AND depends_on_task_id = $2`,
      [req.params.id, req.params.dependsOnId]
    );
    const io = req.app.get("io");
    io.to(`project:${tarefa.project_id}`).emit("task:dependencia-removida", { taskId: req.params.id, dependsOnTaskId: req.params.dependsOnId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover dependência." });
  }
});

// ---------------- Registo de tempo / cronómetro (ClickUp) ----------------

// GET /api/tasks/:id/tempo — histórico de registos + total em segundos
router.get("/:id/tempo", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeVerTarefa(req.user, tarefa))) return res.status(403).json({ erro: "Sem acesso a esta tarefa." });

    const { rows } = await pool.query(
      `SELECT te.id, te.user_id, u.name AS user_name, te.started_at, te.ended_at, te.seconds
       FROM gpitrack.time_entries te
       JOIN gpitrack.users u ON u.id = te.user_id
       WHERE te.task_id = $1 ORDER BY te.started_at DESC`,
      [req.params.id]
    );
    const total = rows.reduce((soma, r) => soma + (r.seconds || (r.ended_at ? 0 : Math.floor((Date.now() - new Date(r.started_at)) / 1000))), 0);
    res.json({ entradas: rows, total_segundos: total, a_correr: rows.find((r) => !r.ended_at && r.user_id === req.user.id) || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter o registo de tempo." });
  }
});

// POST /api/tasks/:id/tempo/iniciar — começa a contar tempo nesta tarefa (um cronómetro por pessoa de cada vez)
router.post("/:id/tempo/iniciar", async (req, res) => {
  try {
    const tarefa = await obterTarefa(req.params.id);
    if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada." });
    if (!(await podeInteragirComTarefa(req.user, tarefa))) {
      return res.status(403).json({ erro: "Só quem é responsável por esta tarefa pode registar tempo nela." });
    }
    const { rows } = await pool.query(
      `INSERT INTO gpitrack.time_entries (task_id, user_id, started_at) VALUES ($1, $2, now())
       RETURNING id, started_at`,
      [req.params.id, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ erro: "Já tem um cronómetro a correr noutra tarefa. Pare-o primeiro." });
    console.error(err);
    res.status(500).json({ erro: "Erro ao iniciar o cronómetro." });
  }
});

// POST /api/tasks/tempo/:entryId/parar — termina um registo de tempo em curso
router.post("/tempo/:entryId/parar", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, task_id, user_id, started_at FROM gpitrack.time_entries WHERE id = $1 AND ended_at IS NULL`,
      [req.params.entryId]
    );
    const entrada = rows[0];
    if (!entrada) return res.status(404).json({ erro: "Registo de tempo não encontrado ou já terminado." });
    if (entrada.user_id !== req.user.id) return res.status(403).json({ erro: "Só pode parar o seu próprio cronómetro." });

    const { rows: atualizado } = await pool.query(
      `UPDATE gpitrack.time_entries SET ended_at = now(), seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
       WHERE id = $1 RETURNING id, task_id, seconds, ended_at`,
      [req.params.entryId]
    );
    const tarefa = await obterTarefa(entrada.task_id);
    const io = req.app.get("io");
    if (tarefa) io.to(`project:${tarefa.project_id}`).emit("task:tempo-registado", { taskId: entrada.task_id, userId: req.user.id, seconds: atualizado[0].seconds });
    res.json(atualizado[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao parar o cronómetro." });
  }
});

module.exports = router;
