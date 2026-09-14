const express = require("express");
const { autenticar, exigirAdmin } = require("../middleware/auth");
const { obterDadosRelatorio } = require("../lib/reportData");
const { novoDocumento, gerarRelatorioGeral, gerarRelatorioProjetos, gerarRelatorioUtilizadores } = require("../lib/pdfReport");

const router = express.Router();
router.use(autenticar, exigirAdmin);

// GET /api/admin/relatorios/dados — dados completos para consulta/visualização na plataforma
router.get("/dados", async (req, res) => {
  try {
    const dados = await obterDadosRelatorio();
    res.json(dados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao obter dados do relatório." });
  }
});

// GET /api/admin/relatorios/pdf?tipo=geral|projetos|utilizadores&projectId=... — gera o PDF
router.get("/pdf", async (req, res) => {
  const { tipo = "geral", projectId } = req.query;
  try {
    const dados = await obterDadosRelatorio();
    const doc = novoDocumento();

    const nomesFicheiro = {
      geral: "relatorio-geral",
      projetos: projectId ? "relatorio-projeto" : "relatorio-projetos",
      utilizadores: "relatorio-utilizadores",
    };
    const nomeFicheiro = `${nomesFicheiro[tipo] || "relatorio"}-${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nomeFicheiro}"`);
    doc.pipe(res);

    if (tipo === "projetos") gerarRelatorioProjetos(doc, dados, req.user.name, projectId || null);
    else if (tipo === "utilizadores") gerarRelatorioUtilizadores(doc, dados, req.user.name);
    else gerarRelatorioGeral(doc, dados, req.user.name);

    doc.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao gerar o PDF." });
  }
});

// ---------------- Exportação CSV ----------------
function paraCsv(linhas) {
  const escapar = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return linhas.map((linha) => linha.map(escapar).join(";")).join("\r\n");
}

// GET /api/admin/relatorios/csv?tipo=projetos|tarefas|utilizadores
router.get("/csv", async (req, res) => {
  const { tipo = "projetos" } = req.query;
  try {
    const dados = await obterDadosRelatorio();
    let cabecalhos, linhas;

    if (tipo === "tarefas") {
      cabecalhos = ["Projeto", "Tarefa", "Coluna", "Prioridade", "Responsável", "Etiquetas", "Checklist", "Comentários", "Criada em"];
      linhas = dados.projetos.flatMap((p) =>
        p.tarefas.map((t) => [
          p.name, t.title, t.coluna, t.priority, t.responsavel_email || "",
          (t.labels || []).map((l) => l.name).join(", "),
          t.checklist_total > 0 ? `${t.checklist_feitos}/${t.checklist_total}` : "",
          t.total_comentarios, new Date(t.created_at).toLocaleDateString("pt-PT"),
        ])
      );
    } else if (tipo === "utilizadores") {
      cabecalhos = ["Nome", "E-mail", "Papel", "Estado", "Projetos", "Tarefas atribuídas", "Tarefas criadas", "Comentários", "Registado em"];
      linhas = dados.utilizadores.map((u) => [
        u.name, u.email, u.role, u.is_active ? "Ativo" : "Desativado",
        u.total_projetos, u.tarefas_atribuidas, u.tarefas_criadas, u.total_comentarios,
        new Date(u.created_at).toLocaleDateString("pt-PT"),
      ]);
    } else {
      cabecalhos = ["Projeto", "Descrição", "Equipa", "Criado por", "Membros", "Total de Tarefas", "Criado em"];
      linhas = dados.projetos.map((p) => [
        p.name, p.description || "", p.team_name || "", p.criado_por || "",
        p.membros.length, p.tarefas.length, new Date(p.created_at).toLocaleDateString("pt-PT"),
      ]);
    }

    const csv = "\uFEFF" + paraCsv([cabecalhos, ...linhas]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="gpitrack-${tipo}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ erro: "Erro ao gerar a exportação CSV." });
  }
});

module.exports = router;
