/**
 * Sincronização em tempo real "à prova de esquecimento".
 *
 * Em vez de depender de cada rota lembrar-se de emitir o seu próprio evento,
 * este middleware observa TODAS as alterações bem-sucedidas (POST/PUT/PATCH/
 * DELETE) feitas a projetos e tarefas e avisa os restantes membros que estão
 * a ver o projeto (evento "projeto:alterado", sem dados sensíveis). O cliente
 * volta então a pedir o quadro — o servidor aplica as regras de visibilidade
 * (tarefas/colunas restritas), por isso ninguém recebe o que não pode ver.
 */
const pool = require("../../db/pool");

// Conversa, reações e cronómetro têm os seus próprios eventos (ou não interessam aos outros)
const IGNORAR = /\/(mensagens|grupos|tempo)(\/|$)/;

// segmento do URL -> consulta que devolve o project_id desse recurso
const RESOLVEDORES = {
  colunas: "SELECT project_id FROM gpitrack.board_columns WHERE id = $1",
  etiquetas: "SELECT project_id FROM gpitrack.labels WHERE id = $1",
  campos: "SELECT project_id FROM gpitrack.project_custom_fields WHERE id = $1",
  metas: "SELECT project_id FROM gpitrack.project_goals WHERE id = $1",
  automacoes: "SELECT project_id FROM gpitrack.automations WHERE id = $1",
  checklist: "SELECT t.project_id FROM gpitrack.checklist_items c JOIN gpitrack.tasks t ON t.id = c.task_id WHERE c.id = $1",
  anexos: "SELECT t.project_id FROM gpitrack.task_attachments a JOIN gpitrack.tasks t ON t.id = a.task_id WHERE a.id = $1",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Descobre o projeto a partir do URL ANTES de a rota correr (depois de um DELETE
// o recurso já não existe e não se conseguiria saber a que projeto pertencia).
async function descobrirProjeto(req, base) {
  const seg = req.originalUrl.split("?")[0].split("/").filter(Boolean).slice(2); // tira "api" e "projects|tasks"
  try {
    if (base === "projects") {
      if (seg[0] && RESOLVEDORES[seg[0]] && UUID.test(seg[1] || "")) {
        const { rows } = await pool.query(RESOLVEDORES[seg[0]], [seg[1]]);
        return rows[0]?.project_id || null;
      }
      return UUID.test(seg[0] || "") ? seg[0] : null;
    }
    if (req.body && UUID.test(req.body.project_id || "")) return req.body.project_id;
    if (seg[0] && RESOLVEDORES[seg[0]] && UUID.test(seg[1] || "")) {
      const { rows } = await pool.query(RESOLVEDORES[seg[0]], [seg[1]]);
      return rows[0]?.project_id || null;
    }
    if (UUID.test(seg[0] || "")) {
      const { rows } = await pool.query("SELECT project_id FROM gpitrack.tasks WHERE id = $1", [seg[0]]);
      return rows[0]?.project_id || null;
    }
  } catch (err) {
    console.error("[sync] Não foi possível determinar o projeto:", err.message);
  }
  return null;
}

function avisarAlteracoes(base) {
  return (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (IGNORAR.test(req.originalUrl.split("?")[0])) return next();
    // Corpo ainda pode não estar lido aqui (multer/json já correram? o json sim): só usado em POST /api/tasks
    const projetoP = descobrirProjeto(req, base);
    res.on("finish", async () => {
      if (res.statusCode >= 400) return;
      const io = req.app.get("io");
      if (!io) return;
      const projectId = (await projetoP) || (await descobrirProjeto(req, base));
      if (!projectId) return;
      io.to(`project:${projectId}`).emit("projeto:alterado", { autorId: req.user?.id || null });
    });
    next();
  };
}

module.exports = { avisarAlteracoes };
