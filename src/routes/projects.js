const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");
const { ehDonoDoProjetoOuAdmin, obterProjeto, ehMembroDoProjeto } = require("../lib/permissions");
const { notificar } = require("../lib/notify");

const router = express.Router();
router.use(autenticar);

// Ficheiros/imagens/áudio partilhados na conversa da equipa
const PASTA_CANAL_MEDIA = path.join(__dirname, "..", "..", "uploads", "channel-media");
fs.mkdirSync(PASTA_CANAL_MEDIA, { recursive: true });
const uploadCanal = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PASTA_CANAL_MEDIA),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// GET /api/projects — lista os projetos do utilizador autenticado
// Notifica quem propôs o convite e todos os responsáveis atuais do projeto
// (sem duplicar, e sem notificar a própria pessoa que respondeu) sempre que
// um convite é aceite ou recusado.
async function notificarInteressadosNoConvite(io, projectId, invitedUserId, invitedBy, mensagem, tipo) {
  const { rows: responsaveis } = await pool.query(
    `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
    [projectId]
  );
  const destinatarios = new Set(responsaveis.map((r) => r.user_id));
  if (invitedBy) destinatarios.add(invitedBy);
  destinatarios.delete(invitedUserId);

  for (const userId of destinatarios) {
    await notificar(io, { userId, type: tipo, content: mensagem, projectId });
  }
}

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.description, p.created_at, p.created_by, pm.role AS meu_papel,
              (SELECT COUNT(*) FROM gpitrack.tasks t WHERE t.project_id = p.id) AS total_tarefas
       FROM gpitrack.projects p
       JOIN gpitrack.project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = $1 AND pm.status = 'ativo'
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter projetos." });
  }
});

// POST /api/projects — cria um novo projeto (com 4 colunas Kanban padrão)
router.post("/", async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ erro: "O nome do projeto é obrigatório." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: teamRows } = await client.query(
      `INSERT INTO gpitrack.teams (name, created_by) VALUES ($1, $2) RETURNING id`,
      [`Equipa de ${name}`, req.user.id]
    );
    const teamId = teamRows[0].id;
    await client.query(
      `INSERT INTO gpitrack.team_members (team_id, user_id, role) VALUES ($1, $2, 'admin')`,
      [teamId, req.user.id]
    );

    const { rows: projRows } = await client.query(
      `INSERT INTO gpitrack.projects (team_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at, created_by`,
      [teamId, name, description || null, req.user.id]
    );
    const project = projRows[0];

    await client.query(
      `INSERT INTO gpitrack.project_members (project_id, user_id, role) VALUES ($1, $2, 'responsavel')`,
      [project.id, req.user.id]
    );

    const colunas = ["Por Fazer", "Em Curso", "Em Revisão", "Concluído"];
    for (let i = 0; i < colunas.length; i++) {
      await client.query(
        `INSERT INTO gpitrack.board_columns (project_id, name, position, is_done) VALUES ($1, $2, $3, $4)`,
        [project.id, colunas[i], i, colunas[i] === "Concluído"]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(project);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar projeto." });
  } finally {
    client.release();
  }
});

// PATCH /api/projects/:id — edita nome/descrição do projeto (apenas dono do projeto ou administrador)
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, description } = req.body;

  const autorizado = await ehDonoDoProjetoOuAdmin(req.user, id);
  if (!autorizado) return res.status(403).json({ erro: "Apenas o criador do projeto ou um administrador pode editá-lo." });

  const updates = [];
  const valores = [];
  if (name !== undefined) { updates.push(`name = $${updates.length + 1}`); valores.push(name); }
  if (description !== undefined) { updates.push(`description = $${updates.length + 1}`); valores.push(description); }
  if (updates.length === 0) return res.status(400).json({ erro: "Nada para atualizar." });

  try {
    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE gpitrack.projects SET ${updates.join(", ")} WHERE id = $${valores.length}
       RETURNING id, name, description, created_by`,
      valores
    );
    const projeto = rows[0];
    if (!projeto) return res.status(404).json({ erro: "Projeto não encontrado." });

    const io = req.app.get("io");
    io.to(`project:${id}`).emit("project:updated", { projeto, autor: req.user.name });

    res.json(projeto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar projeto." });
  }
});

// DELETE /api/projects/:id — elimina definitivamente o projeto (apenas dono do projeto ou administrador)
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const autorizado = await ehDonoDoProjetoOuAdmin(req.user, id);
  if (!autorizado) return res.status(403).json({ erro: "Apenas o criador do projeto ou um administrador pode eliminá-lo." });

  try {
    const { rows: membros } = await pool.query(
      `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1`,
      [id]
    );
    const { rows } = await pool.query(
      `DELETE FROM gpitrack.projects WHERE id = $1 RETURNING id, name`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ erro: "Projeto não encontrado." });

    const io = req.app.get("io");
    io.to(`project:${id}`).emit("project:deleted", { projectId: id, autor: req.user.name });

    for (const m of membros) {
      if (m.user_id !== req.user.id) {
        await notificar(io, {
          userId: m.user_id,
          type: "project.invited",
          content: `${req.user.name} eliminou o projeto "${rows[0].name}".`,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar projeto." });
  }
});

// GET /api/projects/:id/quadro — colunas + tarefas + membros (dados completos do quadro)
router.get("/:id/quadro", async (req, res) => {
  const { id } = req.params;
  try {
    const membro = await pool.query(
      `SELECT role FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'ativo'`,
      [id, req.user.id]
    );
    if (membro.rowCount === 0 && req.user.role !== "admin") return res.status(403).json({ erro: "Sem acesso a este projeto." });

    const souResponsavel = req.user.role === "admin" || membro.rows[0]?.role === "responsavel";

    const colunas = await pool.query(
      `SELECT id, name, position, is_done, restricted FROM gpitrack.board_columns WHERE project_id = $1 ORDER BY position`,
      [id]
    );
    // Colunas restritas (ex.: "Em Revisão") só ficam visíveis para responsáveis/admin
    const colunasVisiveis = souResponsavel ? colunas.rows : colunas.rows.filter((c) => !c.restricted);
    const idsColunasVisiveis = new Set(colunasVisiveis.map((c) => c.id));

    const tarefas = await pool.query(
      `SELECT t.id, t.column_id, t.title, t.description, t.priority, t.due_date, t.position,
              t.created_by, t.created_at, t.updated_at,
              u.id AS assignee_id, u.name AS assignee_name, u.avatar_color AS assignee_color,
              COALESCE(lbl.etiquetas, '[]'::json) AS labels,
              COALESCE(chk.total, 0) AS checklist_total,
              COALESCE(chk.feitos, 0) AS checklist_feitos
       FROM gpitrack.tasks t
       LEFT JOIN gpitrack.users u ON u.id = t.assignee_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)) AS etiquetas
         FROM gpitrack.task_labels tl
         JOIN gpitrack.labels l ON l.id = tl.label_id
         WHERE tl.task_id = t.id
       ) lbl ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_done)::int AS feitos
         FROM gpitrack.checklist_items ci
         WHERE ci.task_id = t.id
       ) chk ON true
       WHERE t.project_id = $1
       ORDER BY t.position ASC`,
      [id]
    );
    const tarefasVisiveis = tarefas.rows.filter((t) => idsColunasVisiveis.has(t.column_id));

    const membros = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_color, pm.role
       FROM gpitrack.project_members pm
       JOIN gpitrack.users u ON u.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.status = 'ativo'
       ORDER BY (pm.role = 'responsavel') DESC, u.name`,
      [id]
    );
    const projeto = await obterProjeto(id);

    res.json({ colunas: colunasVisiveis, tarefas: tarefasVisiveis, membros: membros.rows, projeto, sou_responsavel: souResponsavel });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter o quadro do projeto." });
  }
});

// GET /api/projects/:id/atividade — histórico recente do projeto
router.get("/:id/atividade", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name
       FROM gpitrack.activity_log a
       LEFT JOIN gpitrack.users u ON u.id = a.user_id
       WHERE a.project_id = $1
       ORDER BY a.created_at DESC
       LIMIT 30`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter atividade do projeto." });
  }
});

// ---------------- Colunas do quadro Kanban ----------------

// POST /api/projects/:id/colunas — cria uma nova coluna (apenas dono do projeto ou administrador)
router.post("/:id/colunas", async (req, res) => {
  const { id } = req.params;
  const { name, is_done, restricted } = req.body;
  if (!name) return res.status(400).json({ erro: "O nome da coluna é obrigatório." });

  const autorizado = await ehDonoDoProjetoOuAdmin(req.user, id);
  if (!autorizado) return res.status(403).json({ erro: "Apenas responsáveis do projeto ou um administrador pode gerir colunas." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: posRows } = await client.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM gpitrack.board_columns WHERE project_id = $1`,
      [id]
    );
    // Só pode haver uma coluna "concluído" por projeto — se esta for marcada
    // como tal, desmarca qualquer outra que já o fosse.
    if (is_done) {
      await client.query(`UPDATE gpitrack.board_columns SET is_done = false WHERE project_id = $1`, [id]);
    }
    const { rows } = await client.query(
      `INSERT INTO gpitrack.board_columns (project_id, name, position, is_done, restricted) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, position, is_done, restricted`,
      [id, name, posRows[0].pos, !!is_done, !!restricted]
    );
    await client.query("COMMIT");

    const io = req.app.get("io");
    io.to(`project:${id}`).emit("column:created", rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar coluna." });
  } finally {
    client.release();
  }
});

// PATCH /api/projects/colunas/:columnId — renomeia, marca como coluna concluída
// e/ou restringe o acesso a responsáveis/administradores
router.patch("/colunas/:columnId", async (req, res) => {
  const { columnId } = req.params;
  const { name, is_done, restricted } = req.body;
  if (!name && is_done === undefined && restricted === undefined) {
    return res.status(400).json({ erro: "Nada para atualizar." });
  }

  try {
    const { rows: colRows } = await pool.query(
      `SELECT project_id FROM gpitrack.board_columns WHERE id = $1`,
      [columnId]
    );
    if (colRows.length === 0) return res.status(404).json({ erro: "Coluna não encontrada." });
    const projectId = colRows[0].project_id;

    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, projectId);
    if (!autorizado) return res.status(403).json({ erro: "Apenas responsáveis do projeto ou um administrador pode gerir colunas." });

    if (is_done === true) {
      await pool.query(`UPDATE gpitrack.board_columns SET is_done = false WHERE project_id = $1`, [projectId]);
    }

    const { rows } = await pool.query(
      `UPDATE gpitrack.board_columns SET
         name = COALESCE($1, name),
         is_done = COALESCE($2, is_done),
         restricted = COALESCE($3, restricted)
       WHERE id = $4
       RETURNING id, name, position, is_done, restricted`,
      [name || null, is_done === undefined ? null : is_done, restricted === undefined ? null : restricted, columnId]
    );

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("column:updated", rows[0]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar coluna." });
  }
});

// DELETE /api/projects/colunas/:columnId — elimina uma coluna vazia
router.delete("/colunas/:columnId", async (req, res) => {
  const { columnId } = req.params;
  try {
    const { rows: colRows } = await pool.query(
      `SELECT project_id FROM gpitrack.board_columns WHERE id = $1`,
      [columnId]
    );
    if (colRows.length === 0) return res.status(404).json({ erro: "Coluna não encontrada." });
    const projectId = colRows[0].project_id;

    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, projectId);
    if (!autorizado) return res.status(403).json({ erro: "Apenas o criador do projeto ou um administrador pode gerir colunas." });

    const { rows: tarefasNaColuna } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM gpitrack.tasks WHERE column_id = $1`,
      [columnId]
    );
    if (tarefasNaColuna[0].n > 0) {
      return res.status(409).json({ erro: "Mova ou elimine as tarefas desta coluna antes de a remover." });
    }

    const { rows: totalColunas } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM gpitrack.board_columns WHERE project_id = $1`,
      [projectId]
    );
    if (totalColunas[0].n <= 1) {
      return res.status(409).json({ erro: "O projeto tem de ter pelo menos uma coluna." });
    }

    await pool.query(`DELETE FROM gpitrack.board_columns WHERE id = $1`, [columnId]);

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("column:deleted", { columnId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar coluna." });
  }
});

// ---------------- Etiquetas ----------------

// GET /api/projects/:id/etiquetas — lista as etiquetas do projeto
router.get("/:id/etiquetas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, color FROM gpitrack.labels WHERE project_id = $1 ORDER BY name`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter etiquetas." });
  }
});

// POST /api/projects/:id/etiquetas — cria uma nova etiqueta no projeto
router.post("/:id/etiquetas", async (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ erro: "O nome da etiqueta é obrigatório." });
  try {
    const { rows } = await pool.query(
      `INSERT INTO gpitrack.labels (project_id, name, color) VALUES ($1, $2, $3)
       RETURNING id, name, color`,
      [req.params.id, name, color || "#22C7DD"]
    );
    const io = req.app.get("io");
    io.to(`project:${req.params.id}`).emit("label:created", rows[0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar etiqueta." });
  }
});

// DELETE /api/projects/etiquetas/:labelId — elimina uma etiqueta (apenas dono do projeto ou administrador)
router.delete("/etiquetas/:labelId", async (req, res) => {
  const { labelId } = req.params;
  try {
    const { rows: labelRows } = await pool.query(
      `SELECT project_id FROM gpitrack.labels WHERE id = $1`,
      [labelId]
    );
    if (labelRows.length === 0) return res.status(404).json({ erro: "Etiqueta não encontrada." });
    const projectId = labelRows[0].project_id;

    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, projectId);
    if (!autorizado) return res.status(403).json({ erro: "Apenas o criador do projeto ou um administrador pode gerir etiquetas." });

    await pool.query(`DELETE FROM gpitrack.labels WHERE id = $1`, [labelId]);

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("label:deleted", { labelId });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar etiqueta." });
  }
});

// ---------------- Membros ----------------

// POST /api/projects/:id/membros — convida um utilizador já registado (por e-mail) para o projeto
router.post("/:id/membros", async (req, res) => {
  const { email } = req.body;
  const projectId = req.params.id;
  if (!email) return res.status(400).json({ erro: "O e-mail é obrigatório." });

  // Qualquer membro do projeto pode propor um convite — mas só é enviado
  // diretamente ao convidado se quem propôs já for responsável/admin;
  // caso contrário, primeiro tem de ser aprovado por um responsável.
  const souMembro = await ehMembroDoProjeto(req.user, projectId);
  if (!souMembro) return res.status(403).json({ erro: "Só membros do projeto podem convidar." });
  const souResponsavelOuAdmin = await ehDonoDoProjetoOuAdmin(req.user, projectId);

  try {
    const { rows: userRows } = await pool.query(
      `SELECT id, name, email, avatar_color FROM gpitrack.users WHERE email = $1 AND is_active = true`,
      [email]
    );
    const utilizador = userRows[0];
    if (!utilizador) {
      return res.status(404).json({ erro: "Não existe nenhuma conta ativa com este e-mail." });
    }

    const jaMembro = await pool.query(
      `SELECT status FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, utilizador.id]
    );
    if (jaMembro.rowCount > 0) {
      const msgs = {
        pendente: "Este utilizador já tem um convite pendente para este projeto.",
        aguarda_aprovacao: "Já há um pedido de convite para este utilizador, a aguardar aprovação de um responsável.",
        ativo: "Este utilizador já é membro do projeto.",
      };
      return res.status(409).json({ erro: msgs[jaMembro.rows[0].status] || "Este utilizador já está ligado ao projeto." });
    }

    const projeto = await obterProjeto(projectId);
    const io = req.app.get("io");

    if (souResponsavelOuAdmin) {
      await pool.query(
        `INSERT INTO gpitrack.project_members (project_id, user_id, role, status, invited_by) VALUES ($1, $2, 'membro', 'pendente', $3)`,
        [projectId, utilizador.id, req.user.id]
      );
      await notificar(io, {
        userId: utilizador.id,
        type: "project.invite",
        content: `${req.user.name} convidou-o(a) para o projeto "${projeto?.name}". Veja os detalhes e responda em "Os meus projetos".`,
        projectId,
      });
      return res.status(201).json({ ok: true, status: "pendente" });
    }

    // Membro comum: fica à espera de aprovação de um responsável do projeto
    await pool.query(
      `INSERT INTO gpitrack.project_members (project_id, user_id, role, status, invited_by) VALUES ($1, $2, 'membro', 'aguarda_aprovacao', $3)`,
      [projectId, utilizador.id, req.user.id]
    );

    const { rows: responsaveis } = await pool.query(
      `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
      [projectId]
    );
    for (const r of responsaveis) {
      await notificar(io, {
        userId: r.user_id,
        type: "project.invite_approval_request",
        content: `${req.user.name} propôs convidar ${utilizador.name} para o projeto "${projeto?.name}". Precisa da sua aprovação.`,
        projectId,
      });
    }

    res.status(201).json({ ok: true, status: "aguarda_aprovacao" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao convidar membro." });
  }
});

// GET /api/projects/convites — convites pendentes do utilizador autenticado
router.get("/convites/meus", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS projeto_id, p.name AS projeto_nome, p.description, p.created_at,
              t.name AS equipa_nome, u.name AS convidado_por,
              (SELECT COUNT(*)::int FROM gpitrack.project_members WHERE project_id = p.id AND status = 'ativo') AS total_membros,
              (SELECT COUNT(*)::int FROM gpitrack.tasks WHERE project_id = p.id) AS total_tarefas
       FROM gpitrack.project_members pm
       JOIN gpitrack.projects p ON p.id = pm.project_id
       LEFT JOIN gpitrack.teams t ON t.id = p.team_id
       LEFT JOIN gpitrack.users u ON u.id = pm.invited_by
       WHERE pm.user_id = $1 AND pm.status = 'pendente'
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter convites." });
  }
});

// GET /api/projects/convites/para-aprovar — pedidos de convite (feitos por
// membros comuns) à espera de aprovação, nos projetos onde sou responsável
router.get("/convites/para-aprovar", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id AS projeto_id, p.name AS projeto_nome, u.id AS utilizador_id, u.name AS utilizador_nome, u.email AS utilizador_email,
              prop.name AS proposto_por
       FROM gpitrack.project_members pm
       JOIN gpitrack.projects p ON p.id = pm.project_id
       JOIN gpitrack.users u ON u.id = pm.user_id
       LEFT JOIN gpitrack.users prop ON prop.id = pm.invited_by
       WHERE pm.status = 'aguarda_aprovacao'
         AND (
           $1 = 'admin'
           OR p.id IN (SELECT project_id FROM gpitrack.project_members WHERE user_id = $2 AND role = 'responsavel' AND status = 'ativo')
         )
       ORDER BY p.name`,
      [req.user.role, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter pedidos de convite." });
  }
});

// POST /api/projects/:id/membros/:userId/aprovar-convite — um responsável
// aprova ou rejeita um convite proposto por um membro comum
router.post("/:id/membros/:userId/aprovar-convite", async (req, res) => {
  const projectId = req.params.id;
  const { userId } = req.params;
  const aprovar = !!req.body.aprovar;

  try {
    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, projectId);
    if (!autorizado) return res.status(403).json({ erro: "Só um responsável do projeto (ou administrador) pode aprovar convites." });

    const { rows } = await pool.query(
      `SELECT invited_by FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'aguarda_aprovacao'`,
      [projectId, userId]
    );
    if (rows.length === 0) return res.status(404).json({ erro: "Não há nenhum pedido de convite pendente para esta pessoa." });
    const propostoPor = rows[0].invited_by;

    const projeto = await obterProjeto(projectId);
    const { rows: convidadoRows } = await pool.query(`SELECT name FROM gpitrack.users WHERE id = $1`, [userId]);
    const io = req.app.get("io");

    if (aprovar) {
      await pool.query(`UPDATE gpitrack.project_members SET status = 'pendente' WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
      await notificar(io, {
        userId,
        type: "project.invite",
        content: `Foi convidado(a) para o projeto "${projeto?.name}". Veja os detalhes e responda em "Os meus projetos".`,
        projectId,
      });
      if (propostoPor) {
        await notificar(io, {
          userId: propostoPor,
          type: "project.invite_approved",
          content: `${req.user.name} aprovou o seu convite para ${convidadoRows[0]?.name} entrar em "${projeto?.name}".`,
          projectId,
        });
      }
    } else {
      await pool.query(`DELETE FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2`, [projectId, userId]);
      if (propostoPor) {
        await notificar(io, {
          userId: propostoPor,
          type: "project.invite_rejected",
          content: `${req.user.name} rejeitou o seu pedido para convidar ${convidadoRows[0]?.name} para "${projeto?.name}".`,
          projectId,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao responder ao pedido de convite." });
  }
});

// POST /api/projects/:id/convite/aceitar
router.post("/:id/convite/aceitar", async (req, res) => {
  try {
    const { rows: antes } = await pool.query(
      `SELECT invited_by FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'pendente'`,
      [req.params.id, req.user.id]
    );
    if (antes.length === 0) return res.status(404).json({ erro: "Não há convite pendente para este projeto." });

    await pool.query(
      `UPDATE gpitrack.project_members SET status = 'ativo' WHERE project_id = $1 AND user_id = $2 AND status = 'pendente'`,
      [req.params.id, req.user.id]
    );

    const io = req.app.get("io");
    const { rows } = await pool.query(`SELECT id, name, email, avatar_color FROM gpitrack.users WHERE id = $1`, [req.user.id]);
    io.to(`project:${req.params.id}`).emit("member:added", { membro: rows[0] });

    await notificarInteressadosNoConvite(io, req.params.id, req.user.id, antes[0].invited_by,
      `${req.user.name} aceitou o convite e entrou no projeto.`, "project.invite_accepted");

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao aceitar convite." });
  }
});

// POST /api/projects/:id/convite/recusar
router.post("/:id/convite/recusar", async (req, res) => {
  try {
    const { rows: antes } = await pool.query(
      `SELECT invited_by FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'pendente'`,
      [req.params.id, req.user.id]
    );
    if (antes.length === 0) return res.status(404).json({ erro: "Não há convite pendente para este projeto." });

    await pool.query(
      `DELETE FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'pendente'`,
      [req.params.id, req.user.id]
    );

    const io = req.app.get("io");
    await notificarInteressadosNoConvite(io, req.params.id, req.user.id, antes[0].invited_by,
      `${req.user.name} recusou o convite para o projeto.`, "project.invite_declined");

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao recusar convite." });
  }
});

// GET /api/projects/:id/utilizadores-disponiveis — pesquisa/filtra utilizadores
// para convidar (exclui quem já é membro ativo ou tem convite pendente)
router.get("/:id/utilizadores-disponiveis", async (req, res) => {
  const { search = "", sort = "nome_asc" } = req.query;
  const ordens = {
    nome_asc: "u.name ASC",
    nome_desc: "u.name DESC",
    recente: "u.created_at DESC",
  };
  const ordem = ordens[sort] || ordens.nome_asc;

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_color
       FROM gpitrack.users u
       WHERE u.is_active = true
         AND (u.name ILIKE $2 OR u.email ILIKE $2)
         AND u.id NOT IN (
           SELECT user_id FROM gpitrack.project_members WHERE project_id = $1
         )
       ORDER BY ${ordem}
       LIMIT 30`,
      [req.params.id, `%${search}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao pesquisar utilizadores." });
  }
});

// PATCH /api/projects/:id/membros/:userId/responsavel — torna (ou retira) um
// membro como responsável do projeto. Só um responsável atual (ou admin) pode
// fazer isto, e tem de ficar sempre pelo menos um responsável.
router.patch("/:id/membros/:userId/responsavel", async (req, res) => {
  const projectId = req.params.id;
  const { userId } = req.params;
  const tornarResponsavel = !!req.body.responsavel;

  try {
    const autorizado = await ehDonoDoProjetoOuAdmin(req.user, projectId);
    if (!autorizado) return res.status(403).json({ erro: "Só um responsável do projeto (ou administrador) pode fazer isto." });

    const { rows: alvoRows } = await pool.query(
      `SELECT role FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );
    if (alvoRows.length === 0) return res.status(404).json({ erro: "Esta pessoa não é membro do projeto." });

    if (!tornarResponsavel) {
      const { rows: totalResp } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel'`,
        [projectId]
      );
      if (totalResp[0].n <= 1 && alvoRows[0].role === "responsavel") {
        return res.status(400).json({ erro: "Tem de ficar pelo menos um responsável no projeto." });
      }
    }

    await pool.query(
      `UPDATE gpitrack.project_members SET role = $1 WHERE project_id = $2 AND user_id = $3`,
      [tornarResponsavel ? "responsavel" : "membro", projectId, userId]
    );

    const { rows: projRows } = await pool.query(`SELECT name FROM gpitrack.projects WHERE id = $1`, [projectId]);
    const io = req.app.get("io");
    if (tornarResponsavel && userId !== req.user.id) {
      await notificar(io, {
        userId,
        type: "project.made_responsible",
        content: `${req.user.name} tornou-o(a) responsável pelo projeto "${projRows[0]?.name}".`,
        projectId,
      });
    }
    io.to(`project:${projectId}`).emit("member:role-updated", { userId, role: tornarResponsavel ? "responsavel" : "membro" });

    res.json({ ok: true, role: tornarResponsavel ? "responsavel" : "membro" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar responsabilidade." });
  }
});

// DELETE /api/projects/:id/membros/:userId — remove um membro do projeto
// (o próprio membro pode sair; o dono do projeto/admin pode remover qualquer um, exceto o dono)
router.delete("/:id/membros/:userId", async (req, res) => {
  const { id: projectId, userId } = req.params;
  try {
    const projeto = await obterProjeto(projectId);
    if (!projeto) return res.status(404).json({ erro: "Projeto não encontrado." });

    const { rows: alvoRows } = await pool.query(
      `SELECT role FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2 AND status = 'ativo'`,
      [projectId, userId]
    );
    if (alvoRows.length === 0) return res.status(404).json({ erro: "Esta pessoa não é membro ativo do projeto." });

    // Qualquer membro é livre de sair quando quiser (e o dono do projeto ou
    // admin pode remover qualquer outro) — a única exceção é: o projeto tem
    // sempre de ficar com pelo menos um responsável.
    if (alvoRows[0].role === "responsavel") {
      const { rows: totalResp } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
        [projectId]
      );
      if (totalResp[0].n <= 1) {
        return res.status(400).json({
          erro: userId === req.user.id
            ? "É o único responsável deste projeto — torne outra pessoa responsável antes de sair."
            : "Esta pessoa é a única responsável do projeto — torne outra pessoa responsável antes de a remover.",
        });
      }
    }

    const podeRemover = userId === req.user.id || (await ehDonoDoProjetoOuAdmin(req.user, projectId));
    if (!podeRemover) return res.status(403).json({ erro: "Sem permissão para remover este membro." });

    await pool.query(
      `DELETE FROM gpitrack.project_members WHERE project_id = $1 AND user_id = $2`,
      [projectId, userId]
    );

    const io = req.app.get("io");
    io.to(`project:${projectId}`).emit("member:removed", { userId });

    // Se foi o próprio membro a sair (e não uma remoção por um responsável/admin),
    // notifica todos os responsáveis atuais do projeto — nunca a própria pessoa.
    if (userId === req.user.id) {
      const { rows: responsaveis } = await pool.query(
        `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND role = 'responsavel' AND status = 'ativo'`,
        [projectId]
      );
      for (const r of responsaveis) {
        await notificar(io, {
          userId: r.user_id,
          type: "project.left",
          content: `${req.user.name} saiu do projeto "${projeto.name}".`,
          projectId,
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao remover membro." });
  }
});

// ============================================================
// Canal de conversa geral do projeto (à parte dos comentários por
// tarefa) — inspirado no Slack.
// ============================================================

// GET /api/projects/:id/mensagens
router.get("/:id/mensagens", async (req, res) => {
  try {
    const podeVer = await ehMembroDoProjeto(req.user, req.params.id);
    if (!podeVer) return res.status(403).json({ erro: "Sem permissão para ver esta conversa." });

    const { rows } = await pool.query(
      `SELECT cm.id, cm.content, cm.type, cm.file_name, cm.file_size, cm.mime_type, cm.duration_seconds, cm.created_at,
              u.id AS user_id, u.name AS autor_nome, u.avatar_color
       FROM gpitrack.channel_messages cm
       JOIN gpitrack.users u ON u.id = cm.user_id
       WHERE cm.project_id = $1
       ORDER BY cm.created_at ASC
       LIMIT 200`,
      [req.params.id]
    );
    res.json(rows.map((m) => ({ ...m, url: m.file_name ? `/api/projects/mensagens/${m.id}/ficheiro` : null })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter a conversa." });
  }
});

// POST /api/projects/:id/mensagens — mensagem de texto
router.post("/:id/mensagens", async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ erro: "A mensagem não pode estar vazia." });

  try {
    const podeEnviar = await ehMembroDoProjeto(req.user, req.params.id);
    if (!podeEnviar) return res.status(403).json({ erro: "Sem permissão para enviar mensagens neste projeto." });

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.channel_messages (project_id, user_id, content, type)
       VALUES ($1, $2, $3, 'texto')
       RETURNING id, content, type, created_at`,
      [req.params.id, req.user.id, content.trim()]
    );
    const mensagem = { ...rows[0], user_id: req.user.id, autor_nome: req.user.name, avatar_color: req.user.avatar_color };

    const io = req.app.get("io");
    io.to(`project:${req.params.id}`).emit("channel:message", mensagem);

    res.status(201).json(mensagem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao enviar mensagem." });
  }
});

// POST /api/projects/:id/mensagens/multimedia — ficheiro, imagem/gif ou áudio
router.post("/:id/mensagens/multimedia", uploadCanal.single("ficheiro"), async (req, res) => {
  try {
    const podeEnviar = await ehMembroDoProjeto(req.user, req.params.id);
    if (!podeEnviar) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ erro: "Sem permissão para enviar mensagens neste projeto." });
    }
    if (!req.file) return res.status(400).json({ erro: "Selecione um ficheiro para enviar." });

    let tipo = (req.body.tipo || "ficheiro").trim();
    if (!["imagem", "ficheiro", "audio"].includes(tipo)) tipo = "ficheiro";
    const duracao = req.body.duracao ? parseInt(req.body.duracao, 10) : null;

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.channel_messages
         (project_id, user_id, content, type, file_name, stored_name, file_size, mime_type, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, content, type, file_name, file_size, mime_type, duration_seconds, created_at`,
      [req.params.id, req.user.id, req.body.legenda || null, tipo, req.file.originalname, req.file.filename, req.file.size, req.file.mimetype, duracao]
    );
    const mensagem = {
      ...rows[0], user_id: req.user.id, autor_nome: req.user.name, avatar_color: req.user.avatar_color,
      url: `/api/projects/mensagens/${rows[0].id}/ficheiro`,
    };

    const io = req.app.get("io");
    io.to(`project:${req.params.id}`).emit("channel:message", mensagem);

    res.status(201).json(mensagem);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error(err);
    if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ erro: "O ficheiro excede o limite de 20 MB." });
    res.status(500).json({ erro: "Erro ao enviar ficheiro." });
  }
});

// GET /api/projects/mensagens/:messageId/ficheiro — descarrega/reproduz o media de uma mensagem
router.get("/mensagens/:messageId/ficheiro", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT project_id, file_name, stored_name, mime_type FROM gpitrack.channel_messages WHERE id = $1`,
      [req.params.messageId]
    );
    const msg = rows[0];
    if (!msg || !msg.stored_name) return res.status(404).json({ erro: "Ficheiro não encontrado." });

    const podeVer = await ehMembroDoProjeto(req.user, msg.project_id);
    if (!podeVer) return res.status(403).json({ erro: "Sem permissão para aceder a este ficheiro." });

    const caminho = path.join(PASTA_CANAL_MEDIA, msg.stored_name);
    if (!fs.existsSync(caminho)) return res.status(404).json({ erro: "O ficheiro já não existe no servidor." });

    res.setHeader("Content-Type", msg.mime_type || "application/octet-stream");
    res.sendFile(caminho);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter o ficheiro." });
  }
});

// ============================================================
// Automações simples por projeto — inspirado no Monday.com.
// ============================================================

// GET /api/projects/:id/automacoes
router.get("/:id/automacoes", async (req, res) => {
  try {
    const podeVer = await ehMembroDoProjeto(req.user, req.params.id);
    if (!podeVer) return res.status(403).json({ erro: "Sem permissão para ver automações deste projeto." });

    const { rows } = await pool.query(
      `SELECT a.id, a.name, a.trigger_column_id, a.action_type, a.notify_user_id, a.assign_user_id, a.set_priority,
              a.active, a.created_at,
              bc.name AS coluna_nome, un.name AS notificar_nome, ua.name AS atribuir_nome
       FROM gpitrack.automations a
       JOIN gpitrack.board_columns bc ON bc.id = a.trigger_column_id
       LEFT JOIN gpitrack.users un ON un.id = a.notify_user_id
       LEFT JOIN gpitrack.users ua ON ua.id = a.assign_user_id
       WHERE a.project_id = $1
       ORDER BY a.created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter automações." });
  }
});

// POST /api/projects/:id/automacoes — dono do projeto ou admin
router.post("/:id/automacoes", async (req, res) => {
  const { name, trigger_column_id, action_type, notify_user_id, assign_user_id, set_priority } = req.body;
  if (!name || !trigger_column_id) return res.status(400).json({ erro: "Nome e coluna de gatilho são obrigatórios." });
  const tipo = ["notificar", "atribuir", "definir_prioridade", "concluir_checklist"].includes(action_type) ? action_type : "notificar";
  if (tipo === "atribuir" && !assign_user_id) return res.status(400).json({ erro: "Escolha a quem atribuir a tarefa." });
  if (tipo === "definir_prioridade" && !["alta", "media", "baixa"].includes(set_priority)) {
    return res.status(400).json({ erro: "Escolha uma prioridade válida." });
  }

  try {
    const podeCriar = await ehDonoDoProjetoOuAdmin(req.user, req.params.id);
    if (!podeCriar) return res.status(403).json({ erro: "Só o responsável do projeto pode criar automações." });

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.automations (project_id, name, trigger_column_id, action_type, notify_user_id, assign_user_id, set_priority, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, trigger_column_id, action_type, notify_user_id, assign_user_id, set_priority, active, created_at`,
      [req.params.id, name.trim(), trigger_column_id, tipo, tipo === "notificar" ? (notify_user_id || null) : null, tipo === "atribuir" ? assign_user_id : null, tipo === "definir_prioridade" ? set_priority : null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao criar automação." });
  }
});

// PATCH /api/projects/automacoes/:automationId — ativar/desativar
router.patch("/automacoes/:automationId", async (req, res) => {
  try {
    const { rows: existentes } = await pool.query(`SELECT project_id FROM gpitrack.automations WHERE id = $1`, [req.params.automationId]);
    if (!existentes[0]) return res.status(404).json({ erro: "Automação não encontrada." });

    const podeGerir = await ehDonoDoProjetoOuAdmin(req.user, existentes[0].project_id);
    if (!podeGerir) return res.status(403).json({ erro: "Sem permissão para gerir esta automação." });

    const { rows } = await pool.query(
      `UPDATE gpitrack.automations SET active = $1 WHERE id = $2 RETURNING id, active`,
      [!!req.body.active, req.params.automationId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar automação." });
  }
});

// DELETE /api/projects/automacoes/:automationId
router.delete("/automacoes/:automationId", async (req, res) => {
  try {
    const { rows: existentes } = await pool.query(`SELECT project_id FROM gpitrack.automations WHERE id = $1`, [req.params.automationId]);
    if (!existentes[0]) return res.status(404).json({ erro: "Automação não encontrada." });

    const podeGerir = await ehDonoDoProjetoOuAdmin(req.user, existentes[0].project_id);
    if (!podeGerir) return res.status(403).json({ erro: "Sem permissão para eliminar esta automação." });

    await pool.query(`DELETE FROM gpitrack.automations WHERE id = $1`, [req.params.automationId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar automação." });
  }
});

module.exports = router;
