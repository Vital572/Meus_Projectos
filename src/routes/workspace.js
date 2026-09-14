const express = require("express");
const pool = require("../../db/pool");
const { autenticar } = require("../middleware/auth");
const { ehMembroDoProjeto, obterProjeto, ehDonoDoProjetoOuAdmin } = require("../lib/permissions");
const { notificar } = require("../lib/notify");

const router = express.Router();
router.use(autenticar);

// Só têm acesso ao Espaço de Gestão: administradores da plataforma, e quem for
// responsável de pelo menos um projeto (pode ser mais do que uma pessoa por
// projeto, e não tem de ser quem o criou originalmente).
router.use(async (req, res, next) => {
  if (req.user.role === "admin") return next();
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM gpitrack.project_members WHERE user_id = $1 AND role = 'responsavel' AND status = 'ativo' LIMIT 1`,
      [req.user.id]
    );
    if (rows.length > 0) return next();
    return res.status(403).json({ erro: "O Espaço de Gestão só está disponível para responsáveis de projeto e administradores." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao verificar permissões." });
  }
});

// Devolve os ids de todos os projetos a que o utilizador pertence
// (dono ou membro) — usado como âmbito de tudo o resto abaixo.
async function projetosDoUtilizador(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT p.id FROM gpitrack.projects p
     JOIN gpitrack.project_members pm ON pm.project_id = p.id
     WHERE pm.user_id = $1 AND pm.status = 'ativo'`,
    [userId]
  );
  return rows.map((r) => r.id);
}

// GET /api/workspace/equipas — equipas ligadas aos projetos do utilizador
// (não todas as equipas da plataforma — só as que estão nos seus projetos)
router.get("/equipas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.name, t.created_at,
              COUNT(DISTINCT p.id)::int AS total_projetos,
              COUNT(DISTINCT pm.user_id)::int AS total_membros,
              ARRAY_AGG(DISTINCT p.name) AS nomes_projetos
       FROM gpitrack.teams t
       JOIN gpitrack.projects p ON p.team_id = t.id
       JOIN gpitrack.project_members pm ON pm.project_id = p.id AND pm.status = 'ativo'
       WHERE p.id IN (
         SELECT project_id FROM gpitrack.project_members WHERE user_id = $1 AND status = 'ativo'
       )
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter equipas." });
  }
});

// GET /api/workspace/tarefas — "as minhas tarefas" em todos os projetos
router.get("/tarefas", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.priority, t.due_date, t.created_at,
              p.id AS project_id, p.name AS projeto_nome,
              bc.name AS coluna_nome
       FROM gpitrack.tasks t
       JOIN gpitrack.projects p ON p.id = t.project_id
       JOIN gpitrack.board_columns bc ON bc.id = t.column_id
       WHERE t.assignee_id = $1
          OR EXISTS (SELECT 1 FROM gpitrack.task_responsibles tr WHERE tr.task_id = t.id AND tr.user_id = $1)
       ORDER BY (t.due_date IS NULL), t.due_date ASC, t.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter as suas tarefas." });
  }
});

// GET /api/workspace/membros — colegas de equipa, agrupados por projeto
router.get("/membros", async (req, res) => {
  try {
    const idsProjetos = await projetosDoUtilizador(req.user.id);
    if (idsProjetos.length === 0) return res.json([]);

    const { rows } = await pool.query(
      `SELECT p.id AS project_id, p.name AS projeto_nome, p.created_by,
              u.id AS user_id, u.name, u.email, u.avatar_color
       FROM gpitrack.projects p
       JOIN gpitrack.project_members pm ON pm.project_id = p.id AND pm.status = 'ativo'
       JOIN gpitrack.users u ON u.id = pm.user_id
       WHERE p.id = ANY($1)
       ORDER BY p.name, u.name`,
      [idsProjetos]
    );

    const porProjeto = new Map();
    for (const r of rows) {
      if (!porProjeto.has(r.project_id)) {
        porProjeto.set(r.project_id, { project_id: r.project_id, projeto_nome: r.projeto_nome, membros: [] });
      }
      porProjeto.get(r.project_id).membros.push({
        id: r.user_id, name: r.name, email: r.email, avatar_color: r.avatar_color,
        responsavel: r.created_by === r.user_id,
      });
    }
    res.json([...porProjeto.values()]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter membros." });
  }
});

// GET /api/workspace/dashboard — dados agregados para os gráficos (só os seus projetos)
router.get("/dashboard", async (req, res) => {
  try {
    const idsProjetos = await projetosDoUtilizador(req.user.id);
    if (idsProjetos.length === 0) {
      return res.json({ tarefas_por_prioridade: [], tarefas_por_coluna: [], top_projetos: [], tarefas_por_dia: [] });
    }

    const [porPrioridade, porColuna, topProjetos, tarefasPorDia] = await Promise.all([
      pool.query(
        `SELECT priority, COUNT(*)::int AS total
         FROM gpitrack.tasks WHERE project_id = ANY($1)
         GROUP BY priority`,
        [idsProjetos]
      ),
      pool.query(
        `SELECT bc.name AS coluna, COUNT(t.id)::int AS total
         FROM gpitrack.board_columns bc
         LEFT JOIN gpitrack.tasks t ON t.column_id = bc.id
         WHERE bc.project_id = ANY($1)
         GROUP BY bc.name
         ORDER BY MIN(bc.position)`,
        [idsProjetos]
      ),
      pool.query(
        `SELECT p.name AS projeto, COUNT(t.id)::int AS total
         FROM gpitrack.projects p
         LEFT JOIN gpitrack.tasks t ON t.project_id = p.id
         WHERE p.id = ANY($1)
         GROUP BY p.id
         ORDER BY total DESC
         LIMIT 6`,
        [idsProjetos]
      ),
      pool.query(
        `SELECT to_char(date_trunc('day', d), 'DD/MM') AS dia, COUNT(t.id)::int AS total
         FROM generate_series(now() - interval '13 days', now(), interval '1 day') d
         LEFT JOIN gpitrack.tasks t ON date_trunc('day', t.created_at) = date_trunc('day', d) AND t.project_id = ANY($1)
         GROUP BY date_trunc('day', d)
         ORDER BY date_trunc('day', d)`,
        [idsProjetos]
      ),
    ]);

    res.json({
      tarefas_por_prioridade: porPrioridade.rows,
      tarefas_por_coluna: porColuna.rows,
      top_projetos: topProjetos.rows,
      tarefas_por_dia: tarefasPorDia.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter dados do dashboard." });
  }
});

// GET /api/workspace/relatorios — resumo pessoal (âmbito: só os seus projetos)
router.get("/relatorios", async (req, res) => {
  try {
    const idsProjetos = await projetosDoUtilizador(req.user.id);
    if (idsProjetos.length === 0) {
      return res.json({ total_projetos: 0, total_tarefas: 0, tarefas_concluidas: 0, tarefas_atrasadas: 0, por_prioridade: [] });
    }

    const [tarefas, prioridades] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE bc.is_done = true)::int AS concluidas,
           COUNT(*) FILTER (WHERE t.due_date < now() AND bc.is_done = false)::int AS atrasadas
         FROM gpitrack.tasks t
         JOIN gpitrack.board_columns bc ON bc.id = t.column_id
         WHERE t.assignee_id = $1 AND t.project_id = ANY($2)`,
        [req.user.id, idsProjetos]
      ),
      pool.query(
        `SELECT t.priority, COUNT(*)::int AS total
         FROM gpitrack.tasks t
         WHERE t.assignee_id = $1 AND t.project_id = ANY($2)
         GROUP BY t.priority`,
        [req.user.id, idsProjetos]
      ),
    ]);

    res.json({
      total_projetos: idsProjetos.length,
      total_tarefas: tarefas.rows[0].total,
      tarefas_concluidas: tarefas.rows[0].concluidas,
      tarefas_atrasadas: tarefas.rows[0].atrasadas,
      por_prioridade: prioridades.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao gerar relatório." });
  }
});

// GET /api/workspace/relatorios/exportar.csv — exporta "as minhas tarefas" em CSV
router.get("/relatorios/exportar.csv", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.title, p.name AS projeto, bc.name AS coluna, t.priority, t.due_date
       FROM gpitrack.tasks t
       JOIN gpitrack.projects p ON p.id = t.project_id
       JOIN gpitrack.board_columns bc ON bc.id = t.column_id
       WHERE t.assignee_id = $1
       ORDER BY p.name, t.due_date`,
      [req.user.id]
    );
    const cabecalho = "Tarefa,Projeto,Coluna,Prioridade,Prazo\n";
    const linhas = rows.map((r) =>
      [r.title, r.projeto, r.coluna, r.priority, r.due_date ? new Date(r.due_date).toLocaleDateString("pt-PT") : ""]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")
    ).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=as-minhas-tarefas.csv");
    res.send(cabecalho + linhas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao exportar relatório." });
  }
});

// GET /api/workspace/reunioes — reuniões de todos os projetos do utilizador
router.get("/reunioes", async (req, res) => {
  try {
    const idsProjetos = await projetosDoUtilizador(req.user.id);
    if (idsProjetos.length === 0) return res.json([]);

    const { rows } = await pool.query(
      `SELECT m.id, m.title, m.description, m.scheduled_at, m.location, m.created_at,
              p.id AS project_id, p.name AS projeto_nome,
              u.name AS criado_por_nome, m.created_by
       FROM gpitrack.meetings m
       JOIN gpitrack.projects p ON p.id = m.project_id
       LEFT JOIN gpitrack.users u ON u.id = m.created_by
       WHERE m.project_id = ANY($1)
       ORDER BY m.scheduled_at ASC`,
      [idsProjetos]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter reuniões." });
  }
});

// POST /api/workspace/reunioes — marca uma reunião num dos seus projetos
// (todos os membros do projeto são participantes automáticos e notificados)
router.post("/reunioes", async (req, res) => {
  const { project_id, title, description, scheduled_at, location } = req.body;
  if (!project_id || !title || !scheduled_at) {
    return res.status(400).json({ erro: "Projeto, título e data/hora são obrigatórios." });
  }

  try {
    const podeAgendar = await ehMembroDoProjeto(req.user, project_id);
    if (!podeAgendar) return res.status(403).json({ erro: "Sem permissão para marcar reuniões neste projeto." });

    const { rows } = await pool.query(
      `INSERT INTO gpitrack.meetings (project_id, title, description, scheduled_at, location, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, project_id, title, description, scheduled_at, location, created_at, created_by`,
      [project_id, title.trim(), description || null, scheduled_at, location || null, req.user.id]
    );
    const reuniao = rows[0];
    const projeto = await obterProjeto(project_id);

    const { rows: membros } = await pool.query(
      `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND user_id != $2 AND status = 'ativo'`,
      [project_id, req.user.id]
    );
    const io = req.app.get("io");
    for (const m of membros) {
      await notificar(io, {
        userId: m.user_id,
        type: "meeting.scheduled",
        content: `${req.user.name} marcou a reunião "${title.trim()}" em "${projeto?.name || "um projeto"}".`,
        projectId: project_id,
      });
    }

    res.status(201).json({ ...reuniao, criado_por_nome: req.user.name, projeto_nome: projeto?.name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao marcar reunião." });
  }
});

// DELETE /api/workspace/reunioes/:id — cancela uma reunião (quem a criou, dono do
// projeto, ou administrador da plataforma)
router.delete("/reunioes/:id", async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM gpitrack.meetings WHERE id = $1`, [req.params.id]);
    const reuniao = rows[0];
    if (!reuniao) return res.status(404).json({ erro: "Reunião não encontrada." });

    const podeCancelar = req.user.role === "admin" || reuniao.created_by === req.user.id || (await ehDonoDoProjetoOuAdmin(req.user, reuniao.project_id));
    if (!podeCancelar) return res.status(403).json({ erro: "Sem permissão para cancelar esta reunião." });

    await pool.query(`DELETE FROM gpitrack.meetings WHERE id = $1`, [req.params.id]);

    const io = req.app.get("io");
    const { rows: membros } = await pool.query(
      `SELECT user_id FROM gpitrack.project_members WHERE project_id = $1 AND user_id != $2 AND status = 'ativo'`,
      [reuniao.project_id, req.user.id]
    );
    for (const m of membros) {
      await notificar(io, {
        userId: m.user_id,
        type: "meeting.cancelled",
        content: `${req.user.name} cancelou a reunião "${reuniao.title}".`,
        projectId: reuniao.project_id,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao cancelar reunião." });
  }
});

module.exports = router;
