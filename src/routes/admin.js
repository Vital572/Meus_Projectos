const express = require("express");
const pool = require("../../db/pool");
const { autenticar, exigirAdmin } = require("../middleware/auth");
const { desconectarUtilizador, utilizadoresOnlineGlobal } = require("../sockets");
const { notificar } = require("../lib/notify");
const { verificarPrazosDeTarefas } = require("../lib/lembretes");

const router = express.Router();
router.use(autenticar, exigirAdmin);

// GET /api/admin/utilizadores — lista todos os utilizadores registados, com estado online
router.get("/utilizadores", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, avatar_color, role, is_active, last_seen_at, created_at
       FROM gpitrack.users ORDER BY created_at DESC`
    );
    const onlineIds = new Set(utilizadoresOnlineGlobal().map((u) => u.id));
    const utilizadores = rows.map((u) => ({ ...u, online: onlineIds.has(u.id) }));
    res.json(utilizadores);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter utilizadores." });
  }
});

// GET /api/admin/online — utilizadores atualmente ligados (tempo real, snapshot)
router.get("/online", (req, res) => {
  res.json(utilizadoresOnlineGlobal());
});

// PATCH /api/admin/utilizadores/:id — ativar/desativar conta ou mudar o papel
router.patch("/utilizadores/:id", async (req, res) => {
  const { id } = req.params;
  const { is_active, role } = req.body;

  if (id === req.user.id && (is_active === false || role === "member")) {
    return res.status(400).json({ erro: "Não pode remover as suas próprias permissões de administrador ou desativar-se a si próprio." });
  }

  const updates = [];
  const valores = [];
  if (is_active !== undefined) { updates.push(`is_active = $${updates.length + 1}`); valores.push(is_active); }
  if (role !== undefined) { updates.push(`role = $${updates.length + 1}`); valores.push(role); }
  if (updates.length === 0) return res.status(400).json({ erro: "Nada para atualizar." });

  try {
    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE gpitrack.users SET ${updates.join(", ")} WHERE id = $${valores.length}
       RETURNING id, name, email, role, is_active`,
      valores
    );
    const utilizador = rows[0];
    if (!utilizador) return res.status(404).json({ erro: "Utilizador não encontrado." });

    // Se a conta foi desativada, força o encerramento imediato de todas as sessões ativas
    if (is_active === false) {
      desconectarUtilizador(id, "A sua conta foi desativada por um administrador.");
    }

    res.json(utilizador);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao atualizar utilizador." });
  }
});

// DELETE /api/admin/utilizadores/:id — remove definitivamente um utilizador
router.delete("/utilizadores/:id", async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ erro: "Não pode eliminar a sua própria conta." });
  try {
    const { rows } = await pool.query(`DELETE FROM gpitrack.users WHERE id = $1 RETURNING id`, [id]);
    if (rows.length === 0) return res.status(404).json({ erro: "Utilizador não encontrado." });
    desconectarUtilizador(id, "A sua conta foi removida por um administrador.");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao eliminar utilizador." });
  }
});

// GET /api/admin/projetos — lista todos os projetos da plataforma
router.get("/projetos", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name, p.created_at,
             t.name AS team_name,
             u.name AS criado_por,
             (SELECT COUNT(*) FROM gpitrack.project_members pm WHERE pm.project_id = p.id AND pm.status = 'ativo') AS total_membros,
             (SELECT COUNT(*) FROM gpitrack.tasks tk WHERE tk.project_id = p.id) AS total_tarefas
      FROM gpitrack.projects p
      LEFT JOIN gpitrack.teams t ON t.id = p.team_id
      LEFT JOIN gpitrack.users u ON u.id = p.created_by
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter projetos." });
  }
});

// GET /api/admin/dashboard — dados agregados para os gráficos da Visão Geral
router.get("/dashboard", async (req, res) => {
  try {
    const [porPrioridade, porColuna, topProjetos, registosPorDia, tarefasPorDia] = await Promise.all([
      pool.query(`
        SELECT priority, COUNT(*)::int AS total
        FROM gpitrack.tasks
        GROUP BY priority
      `),
      pool.query(`
        SELECT bc.name AS coluna, COUNT(t.id)::int AS total
        FROM gpitrack.board_columns bc
        LEFT JOIN gpitrack.tasks t ON t.column_id = bc.id
        GROUP BY bc.name
        ORDER BY MIN(bc.position)
      `),
      pool.query(`
        SELECT p.name AS projeto, COUNT(t.id)::int AS total
        FROM gpitrack.projects p
        LEFT JOIN gpitrack.tasks t ON t.project_id = p.id
        GROUP BY p.id
        ORDER BY total DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT to_char(date_trunc('day', d), 'DD/MM') AS dia,
               COUNT(u.id)::int AS total
        FROM generate_series(now() - interval '13 days', now(), interval '1 day') d
        LEFT JOIN gpitrack.users u ON date_trunc('day', u.created_at) = date_trunc('day', d)
        GROUP BY date_trunc('day', d)
        ORDER BY date_trunc('day', d)
      `),
      pool.query(`
        SELECT to_char(date_trunc('day', d), 'DD/MM') AS dia,
               COUNT(t.id)::int AS total
        FROM generate_series(now() - interval '13 days', now(), interval '1 day') d
        LEFT JOIN gpitrack.tasks t ON date_trunc('day', t.created_at) = date_trunc('day', d)
        GROUP BY date_trunc('day', d)
        ORDER BY date_trunc('day', d)
      `),
    ]);

    res.json({
      tarefas_por_prioridade: porPrioridade.rows,
      tarefas_por_coluna: porColuna.rows,
      top_projetos: topProjetos.rows,
      registos_por_dia: registosPorDia.rows,
      tarefas_por_dia: tarefasPorDia.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter dados do dashboard." });
  }
});

// GET /api/admin/estatisticas — números gerais da plataforma
router.get("/estatisticas", async (req, res) => {
  try {
    const [utilizadores, projetos, tarefas, concluidas] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM gpitrack.users`),
      pool.query(`SELECT COUNT(*)::int AS n FROM gpitrack.projects`),
      pool.query(`SELECT COUNT(*)::int AS n FROM gpitrack.tasks`),
      pool.query(`
        SELECT COUNT(*)::int AS n FROM gpitrack.tasks t
        JOIN gpitrack.board_columns c ON c.id = t.column_id
        WHERE c.is_done = true
      `),
    ]);
    res.json({
      total_utilizadores: utilizadores.rows[0].n,
      total_projetos: projetos.rows[0].n,
      total_tarefas: tarefas.rows[0].n,
      tarefas_concluidas: concluidas.rows[0].n,
      online_agora: utilizadoresOnlineGlobal().length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter estatísticas." });
  }
});

// GET /api/admin/notificacoes — visão geral das notificações da plataforma
// (estatísticas por tipo + lista das mais recentes, com destinatário e projeto)
router.get("/notificacoes", async (req, res) => {
  try {
    const [totais, porTipo, recentes] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE is_read = false)::int AS nao_lidas
        FROM gpitrack.notifications
      `),
      pool.query(`
        SELECT type, COUNT(*)::int AS total
        FROM gpitrack.notifications
        GROUP BY type
        ORDER BY total DESC
      `),
      pool.query(`
        SELECT n.id, n.type, n.content, n.is_read, n.created_at,
               u.name AS destinatario_nome, u.email AS destinatario_email,
               p.name AS projeto_nome
        FROM gpitrack.notifications n
        JOIN gpitrack.users u ON u.id = n.user_id
        LEFT JOIN gpitrack.projects p ON p.id = n.project_id
        ORDER BY n.created_at DESC
        LIMIT 100
      `),
    ]);
    res.json({
      total: totais.rows[0].total,
      nao_lidas: totais.rows[0].nao_lidas,
      por_tipo: porTipo.rows,
      recentes: recentes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter notificações." });
  }
});

// GET /api/admin/mensagens — histórico de anúncios enviados pela administração
router.get("/mensagens", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.content, m.audience, m.total_destinatarios, m.created_at,
             s.name AS remetente_nome,
             p.name AS projeto_nome,
             du.name AS destinatario_nome
      FROM gpitrack.admin_messages m
      LEFT JOIN gpitrack.users s ON s.id = m.sender_id
      LEFT JOIN gpitrack.projects p ON p.id = m.project_id
      LEFT JOIN gpitrack.users du ON du.id = m.user_id
      ORDER BY m.created_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter mensagens." });
  }
});

// POST /api/admin/mensagens — envia um anúncio (a todos, a um projeto, ou a um utilizador)
// Cada destinatário recebe uma notificação em tempo real (type: admin.announcement).
router.post("/mensagens", async (req, res) => {
  const { content, audience, projectId, userId } = req.body;

  if (!content || !content.trim()) {
    return res.status(400).json({ erro: "A mensagem não pode estar vazia." });
  }
  if (!["todos", "projeto", "utilizador"].includes(audience)) {
    return res.status(400).json({ erro: "Destino inválido." });
  }
  if (audience === "projeto" && !projectId) {
    return res.status(400).json({ erro: "Selecione o projeto de destino." });
  }
  if (audience === "utilizador" && !userId) {
    return res.status(400).json({ erro: "Selecione o utilizador de destino." });
  }

  try {
    let destinatarios = [];

    if (audience === "todos") {
      const { rows } = await pool.query(
        `SELECT id FROM gpitrack.users WHERE is_active = true AND id != $1`,
        [req.user.id]
      );
      destinatarios = rows.map((r) => r.id);
    } else if (audience === "projeto") {
      const { rows } = await pool.query(
        `SELECT user_id AS id FROM gpitrack.project_members WHERE project_id = $1 AND user_id != $2 AND status = 'ativo'`,
        [projectId, req.user.id]
      );
      destinatarios = rows.map((r) => r.id);
    } else {
      destinatarios = [userId];
    }

    const { rows: msgRows } = await pool.query(
      `INSERT INTO gpitrack.admin_messages (sender_id, content, audience, project_id, user_id, total_destinatarios)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, content, audience, project_id, user_id, total_destinatarios, created_at`,
      [req.user.id, content.trim(), audience, audience === "projeto" ? projectId : null, audience === "utilizador" ? userId : null, destinatarios.length]
    );

    const io = req.app.get("io");
    for (const destId of destinatarios) {
      await notificar(io, {
        userId: destId,
        type: "admin.announcement",
        content: content.trim(),
        projectId: audience === "projeto" ? projectId : null,
      });
    }

    res.status(201).json(msgRows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao enviar mensagem." });
  }
});

// GET /api/admin/feedback — feedback enviado pela página inicial e pelo Espaço de Gestão
router.get("/feedback", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, message, page, is_read, created_at
       FROM gpitrack.feedback
       ORDER BY created_at DESC
       LIMIT 200`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter feedback." });
  }
});

// PATCH /api/admin/feedback/:id/lida
router.patch("/feedback/:id/lida", async (req, res) => {
  try {
    await pool.query(`UPDATE gpitrack.feedback SET is_read = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao marcar como lido." });
  }
});

// POST /api/admin/lembretes/executar — dispara manualmente a verificação de
// prazos (a mesma que corre todos os dias às 08:00) — útil para testar.
router.post("/lembretes/executar", async (req, res) => {
  try {
    const io = req.app.get("io");
    const resultado = await verificarPrazosDeTarefas(io);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao verificar prazos." });
  }
});

module.exports = router;
