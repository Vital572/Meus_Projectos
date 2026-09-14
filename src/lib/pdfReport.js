const PDFDocument = require("pdfkit");

const NAVY = "#0B1220";
const NAVY_LIGHT = "#1B2A4A";
const CYAN = "#22C7DD";
const GREY = "#555555";
const LIGHT_BG = "#F0F4F9";
const INK = "#111111";

function novoDocumento() {
  return new PDFDocument({ size: "A4", margin: 50, bufferedPageRange: true, autoFirstPage: true, bufferPages: true });
}

/** Cabeçalho colorido no topo da página atual. */
function cabecalho(doc, titulo, subtitulo) {
  doc.rect(0, 0, doc.page.width, 86).fill(NAVY);
  doc.fillColor(CYAN).fontSize(9).font("Helvetica-Bold").text("GPI TRACK", 50, 24, { characterSpacing: 2 });
  doc.fillColor("#FFFFFF").fontSize(18).font("Helvetica-Bold").text(titulo, 50, 40);
  if (subtitulo) doc.fillColor("#AAB8D6").fontSize(9).font("Helvetica").text(subtitulo, 50, 64);
  doc.fillColor(INK);
  doc.y = 106;
}

/** Rodapé com autor, data e número de página em todas as páginas do documento. */
function rodape(doc, autor) {
  const range = doc.bufferedPageRange();
  const margemOriginal = doc.page.margins.bottom;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // A margem inferior é temporariamente removida para permitir escrever
    // o rodapé dentro dela sem que o PDFKit dispare automaticamente uma
    // nova página (o que acontecia antes desta correção).
    doc.page.margins.bottom = 0;
    doc.fontSize(8).fillColor(GREY).font("Helvetica")
      .text(`Gerado por ${autor} em ${new Date().toLocaleString("pt-PT")}`, 50, doc.page.height - 34, { width: 320, lineBreak: false });
    doc.fontSize(8).fillColor(GREY)
      .text(`Página ${i - range.start + 1} de ${range.count}`, doc.page.width - 170, doc.page.height - 34, { width: 120, align: "right", lineBreak: false });
    doc.page.margins.bottom = margemOriginal;
  }
}

function tituloSeccao(doc, texto) {
  doc.x = 50;
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6);
  doc.fontSize(13).font("Helvetica-Bold").fillColor(NAVY_LIGHT).text(texto, 50, doc.y, { continued: false });
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).strokeColor(CYAN).lineWidth(1.4).stroke();
  doc.moveDown(0.5);
  doc.x = 50;
  doc.fillColor(INK).font("Helvetica");
}

function paragrafo(doc, texto, opts = {}) {
  doc.x = 50;
  doc.fontSize(opts.size || 9.5).fillColor(opts.color || INK).font(opts.bold ? "Helvetica-Bold" : "Helvetica")
    .text(texto, 50, doc.y, { width: doc.page.width - 100, ...opts });
  doc.x = 50;
  doc.moveDown(opts.moveDown ?? 0.3);
}

/**
 * Desenha uma tabela simples com cabeçalho colorido, linhas alternadas,
 * e quebra de página automática mantendo o cabeçalho repetido.
 */
function tabela(doc, { larguras, cabecalhos, linhas, corCabecalho = NAVY_LIGHT }) {
  const x0 = 50;
  const alturaLinha = 20;
  const larguraTotal = larguras.reduce((a, b) => a + b, 0);

  function desenharCabecalho() {
    doc.rect(x0, doc.y, larguraTotal, alturaLinha).fill(corCabecalho);
    let cx = x0;
    const yTexto = doc.y + 6;
    doc.fillColor("#FFFFFF").fontSize(7.5).font("Helvetica-Bold");
    cabecalhos.forEach((h, i) => {
      doc.text(h, cx + 4, yTexto, { width: larguras[i] - 6, height: alturaLinha - 8, ellipsis: true, lineBreak: false });
      cx += larguras[i];
    });
    doc.y += alturaLinha;
  }

  if (doc.y + alturaLinha * 2 > doc.page.height - 70) doc.addPage();
  desenharCabecalho();

  linhas.forEach((linha, idx) => {
    if (doc.y + alturaLinha > doc.page.height - 70) {
      doc.addPage();
      desenharCabecalho();
    }
    if (idx % 2 === 0) doc.rect(x0, doc.y, larguraTotal, alturaLinha).fill(LIGHT_BG);
    let cx = x0;
    const yTexto = doc.y + 6;
    doc.fillColor(INK).fontSize(7.5).font("Helvetica");
    linha.forEach((val, i) => {
      doc.text(val === null || val === undefined || val === "" ? "—" : String(val), cx + 4, yTexto, {
        width: larguras[i] - 6,
        height: alturaLinha - 8,
        ellipsis: true,
        lineBreak: false,
      });
      cx += larguras[i];
    });
    doc.y += alturaLinha;
  });
  doc.moveDown(0.8);
}

function caixaResumo(doc, itens) {
  const largura = (doc.page.width - 100 - (itens.length - 1) * 10) / itens.length;
  const y = doc.y;
  itens.forEach((item, i) => {
    const x = 50 + i * (largura + 10);
    doc.roundedRect(x, y, largura, 52, 6).fill(NAVY);
    doc.fillColor(CYAN).fontSize(18).font("Helvetica-Bold").text(String(item.valor), x, y + 8, { width: largura, align: "center" });
    doc.fillColor("#AAB8D6").fontSize(7.5).font("Helvetica").text(item.rotulo, x, y + 32, { width: largura, align: "center" });
  });
  doc.y = y + 52 + 16;
  doc.x = 50;
  doc.fillColor(INK);
}

function nomeColuna(labels) {
  return (labels || []).map((l) => l.name).join(", ");
}

// ---------------- Relatório Geral ----------------
function gerarRelatorioGeral(doc, dados, autor) {
  cabecalho(doc, "Relatório Geral da Plataforma", `Visão consolidada de projetos, tarefas e utilizadores`);

  const totalTarefas = dados.projetos.reduce((acc, p) => acc + p.tarefas.length, 0);
  const totalConcluidas = dados.projetos.reduce((acc, p) => acc + p.tarefas.filter((t) => t.coluna_concluida).length, 0);

  caixaResumo(doc, [
    { valor: dados.utilizadores.length, rotulo: "UTILIZADORES" },
    { valor: dados.projetos.length, rotulo: "PROJETOS" },
    { valor: totalTarefas, rotulo: "TAREFAS" },
    { valor: totalConcluidas, rotulo: "CONCLUÍDAS" },
  ]);

  tituloSeccao(doc, "Projetos");
  tabela(doc, {
    larguras: [140, 90, 70, 60, 60, 75],
    cabecalhos: ["Projeto", "Criado por", "Equipa", "Membros", "Tarefas", "Criado em"],
    linhas: dados.projetos.map((p) => [
      p.name, p.criado_por, p.team_name, p.membros.length, p.tarefas.length,
      new Date(p.created_at).toLocaleDateString("pt-PT"),
    ]),
  });

  tituloSeccao(doc, "Utilizadores");
  tabela(doc, {
    larguras: [110, 130, 55, 55, 55, 60],
    cabecalhos: ["Nome", "E-mail", "Papel", "Atribuídas", "Criadas", "Coment."],
    linhas: dados.utilizadores.map((u) => [
      u.name, u.email, u.role === "admin" ? "Admin" : "Membro",
      u.tarefas_atribuidas, u.tarefas_criadas, u.total_comentarios,
    ]),
  });

  rodape(doc, autor);
}

// ---------------- Relatório de Projetos (todos ou um específico) ----------------
function gerarRelatorioProjetos(doc, dados, autor, projectId) {
  const projetos = projectId ? dados.projetos.filter((p) => p.id === projectId) : dados.projetos;

  cabecalho(doc, "Relatório de Projetos e Tarefas",
    projectId ? `Detalhe do projeto selecionado` : `Todos os projetos (${projetos.length})`);

  projetos.forEach((p) => {
    tituloSeccao(doc, p.name);

    paragrafo(doc, p.description || "Sem descrição.", { size: 9, color: GREY, moveDown: 0.4 });
    paragrafo(doc, `Equipa: ${p.team_name || "—"}   ·   Criado por: ${p.criado_por || "—"}   ·   Membros: ${p.membros.map((m) => m.name).join(", ") || "—"}`, { size: 8.5, color: GREY, moveDown: 0.6 });

    if (p.tarefas.length === 0) {
      paragrafo(doc, "Este projeto ainda não tem tarefas.", { size: 9, color: GREY, moveDown: 0.8 });
      return;
    }

    tabela(doc, {
      larguras: [125, 65, 55, 85, 90, 55],
      cabecalhos: ["Tarefa", "Coluna", "Prioridade", "Responsável", "Etiquetas", "Checklist"],
      linhas: p.tarefas.map((t) => [
        t.title, t.coluna, t.priority, t.responsavel_nome, nomeColuna(t.labels),
        t.checklist_total > 0 ? `${t.checklist_feitos}/${t.checklist_total}` : "—",
      ]),
    });
  });

  rodape(doc, autor);
}

// ---------------- Relatório de Utilizadores ----------------
function gerarRelatorioUtilizadores(doc, dados, autor) {
  cabecalho(doc, "Relatório de Utilizadores", `Atividade e participação por conta registada`);

  caixaResumo(doc, [
    { valor: dados.utilizadores.length, rotulo: "TOTAL" },
    { valor: dados.utilizadores.filter((u) => u.role === "admin").length, rotulo: "ADMINISTRADORES" },
    { valor: dados.utilizadores.filter((u) => u.is_active).length, rotulo: "ATIVOS" },
    { valor: dados.utilizadores.filter((u) => !u.is_active).length, rotulo: "DESATIVADOS" },
  ]);

  tituloSeccao(doc, "Detalhe por utilizador");
  tabela(doc, {
    larguras: [100, 130, 50, 55, 60, 55, 55],
    cabecalhos: ["Nome", "E-mail", "Papel", "Estado", "Projetos", "Tarefas", "Coment."],
    linhas: dados.utilizadores.map((u) => [
      u.name, u.email, u.role === "admin" ? "Admin" : "Membro", u.is_active ? "Ativo" : "Desativado",
      u.total_projetos, u.tarefas_atribuidas, u.total_comentarios,
    ]),
  });

  rodape(doc, autor);
}

module.exports = {
  novoDocumento,
  gerarRelatorioGeral,
  gerarRelatorioProjetos,
  gerarRelatorioUtilizadores,
};
