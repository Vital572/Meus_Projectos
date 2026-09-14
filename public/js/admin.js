let eu = null;
let socket = null;

const rotuloTabs = { "visao-geral": "tab-visao-geral", "utilizadores": "tab-utilizadores", "online": "tab-online", "projetos": "tab-projetos", "notificacoes": "tab-notificacoes", "mensagens": "tab-mensagens", "relatorios": "tab-relatorios", "feedback": "tab-feedback" };

async function iniciar() {
  if (!sessao.obterToken()) { window.location.href = "/entrar.html"; return; }

  try {
    const { user } = await api.get("/api/auth/eu");
    eu = user;
  } catch {
    sessao.limpar();
    window.location.href = "/entrar.html";
    return;
  }
  if (eu.role !== "admin") {
    alert("Acesso restrito a administradores.");
    window.location.href = "/projetos.html";
    return;
  }

  document.getElementById("user-chip").innerHTML = `
    <div class="avatar" style="background:#22C7DD">${iniciais(eu.name)}</div>
    <div class="who">${eu.name}<small>Administrador</small></div>
    <div class="logout-link" onclick="sair()">Saír</div>
  `;

  // Se veio de dentro de um projeto (ex.: clicou em "Administração" a partir do
  // quadro), "Voltar" deve levar de volta a esse projeto, não à lista de projetos.
  const voltarProjeto = new URLSearchParams(window.location.search).get("voltar");
  if (voltarProjeto) {
    document.getElementById("link-voltar").setAttribute("onclick", `location.href='/board.html?projeto=${voltarProjeto}'`);
  }

  socket = io({ auth: { token: sessao.obterToken() } });
  iniciarNotificacoes(socket);

  ligarNavegacao();
  ligarPesquisaLista("pesquisa-utilizadores", "tbody-utilizadores");
  ligarPesquisaLista("pesquisa-online", "lista-online");
  ligarPesquisaLista("pesquisa-projetos-admin", "tbody-projetos");
  ligarPesquisaLista("pesquisa-notificacoes", "tbody-notificacoes");
  ligarPesquisaLista("pesquisa-mensagens", "tbody-mensagens");
  ligarPesquisaLista("pesquisa-feedback", "lista-feedback");
  await Promise.all([carregarEstatisticas(), carregarDashboard(), carregarUtilizadores(), carregarOnline(), carregarProjetos(), carregarDadosRelatorio(), carregarFeedback()]);
  await Promise.all([carregarNotificacoesAdmin(), carregarMensagens()]);
  document.getElementById("mensagem-destino")?.addEventListener("change", alternarCamposMensagem);

  socket.on("admin:presence", (lista) => {
    renderizarOnline(lista);
    marcarOnlineNaTabela(lista);
  });
}

function ligarNavegacao() {
  document.querySelectorAll(".admin-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".admin-nav-item").forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      Object.values(rotuloTabs).forEach((id) => (document.getElementById(id).style.display = "none"));
      document.getElementById(rotuloTabs[item.dataset.tab]).style.display = "block";
    });
  });
}

async function carregarEstatisticas() {
  const s = await api.get("/api/admin/estatisticas");
  const html = `
    <div class="stat-card"><div class="num">${s.total_utilizadores}</div><div class="label">Utilizadores registados</div></div>
    <div class="stat-card"><div class="num">${s.online_agora}</div><div class="label">Online agora</div></div>
    <div class="stat-card"><div class="num">${s.total_projetos}</div><div class="label">Projetos criados</div></div>
    <div class="stat-card"><div class="num">${s.total_tarefas}</div><div class="label">Tarefas totais</div></div>
    <div class="stat-card"><div class="num">${s.tarefas_concluidas}</div><div class="label">Tarefas concluídas</div></div>
  `;
  document.getElementById("grid-estatisticas").innerHTML = html;
  document.getElementById("grid-estatisticas-rel").innerHTML = html;
}

// ---------------- Gráficos do dashboard ----------------
const CHART_CYAN = "#22C7DD";
const CHART_CYAN_DIM = "rgba(34,199,221,0.18)";
const CHART_CORES = ["#22C7DD", "#F0B429", "#34C77B", "#EF6461", "#8E7CC3", "#E67E22"];
const CHART_GRID = "rgba(255,255,255,0.06)";
const CHART_TEXTO = "#8A96AE";
Chart.defaults.color = CHART_TEXTO;
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.font.size = 11.5;

let graficosAtivos = {};
function desenharGrafico(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (graficosAtivos[id]) graficosAtivos[id].destroy();
  graficosAtivos[id] = new Chart(canvas.getContext("2d"), config);
}

// Desenha o mesmo gráfico em dois sítios (Visão Geral + Relatórios) — cada um
// com a sua própria instância/config, para não partilharem estado do Chart.js.
function desenharNosDois(idBase, construirConfig) {
  desenharGrafico(idBase, construirConfig());
  desenharGrafico(`${idBase}-rel`, construirConfig());
}

async function carregarDashboard() {
  const d = await api.get("/api/admin/dashboard");

  desenharNosDois("chart-tarefas-dia", () => ({
    type: "line",
    data: { labels: d.tarefas_por_dia.map((r) => r.dia), datasets: [{
      data: d.tarefas_por_dia.map((r) => r.total), borderColor: CHART_CYAN, backgroundColor: CHART_CYAN_DIM,
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
    }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: CHART_GRID }, beginAtZero: true, ticks: { precision: 0 } } } },
  }));

  desenharNosDois("chart-registos-dia", () => ({
    type: "bar",
    data: { labels: d.registos_por_dia.map((r) => r.dia), datasets: [{
      data: d.registos_por_dia.map((r) => r.total), backgroundColor: CHART_CYAN, borderRadius: 4, maxBarThickness: 18,
    }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: CHART_GRID }, beginAtZero: true, ticks: { precision: 0 } } } },
  }));

  desenharNosDois("chart-prioridade", () => ({
    type: "doughnut",
    data: {
      labels: d.tarefas_por_prioridade.map((r) => ({ alta: "Alta", media: "Média", baixa: "Baixa" }[r.priority] || r.priority)),
      datasets: [{ data: d.tarefas_por_prioridade.map((r) => r.total), backgroundColor: CHART_CORES, borderColor: "#111A2E", borderWidth: 2 }],
    },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 14 } } } },
  }));

  desenharNosDois("chart-colunas", () => ({
    type: "doughnut",
    data: { labels: d.tarefas_por_coluna.map((r) => r.coluna), datasets: [{
      data: d.tarefas_por_coluna.map((r) => r.total), backgroundColor: CHART_CORES, borderColor: "#111A2E", borderWidth: 2,
    }] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 14 } } } },
  }));

  desenharNosDois("chart-projetos", () => ({
    type: "bar",
    data: { labels: d.top_projetos.map((r) => r.projeto), datasets: [{
      data: d.top_projetos.map((r) => r.total), backgroundColor: CHART_CYAN, borderRadius: 5, maxBarThickness: 42,
    }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { grid: { color: CHART_GRID }, beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
  }));
}

let utilizadoresCache = [];
async function carregarUtilizadores() {
  utilizadoresCache = await api.get("/api/admin/utilizadores");
  renderizarUtilizadores();
}

function renderizarUtilizadores() {
  document.getElementById("tbody-utilizadores").innerHTML = utilizadoresCache.map((u) => `
    <tr data-user-id="${u.id}">
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:26px;height:26px;font-size:11px;background:${u.avatar_color}">${iniciais(u.name)}</div>
          <div>
            <div style="font-weight:600">${u.online ? '<span class="dot-online"></span>' : ""}${u.name}</div>
            <div style="font-size:11.5px;color:var(--ink-faint)">${u.email}</div>
          </div>
        </div>
      </td>
      <td><span class="badge-role ${u.role}">${u.role === "admin" ? "Administrador" : "Membro"}</span></td>
      <td><span class="badge-status ${u.is_active ? "ativo" : "inativo"}">${u.is_active ? "Ativo" : "Desativado"}</span></td>
      <td style="color:var(--ink-faint);font-size:12.5px">${u.last_seen_at ? new Date(u.last_seen_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(u.created_at).toLocaleDateString("pt-PT")}</td>
      <td>
        ${u.id === eu.id ? '<span style="font-size:11.5px;color:var(--ink-faint)">A sua conta</span>' : `
          <button class="mini-btn" onclick="alternarPapel('${u.id}', '${u.role}')">${u.role === "admin" ? "Tornar membro" : "Tornar admin"}</button>
          <button class="mini-btn ${u.is_active ? "danger" : ""}" onclick="alternarEstado('${u.id}', ${u.is_active})">${u.is_active ? "Desativar" : "Reativar"}</button>
          <button class="mini-btn danger" onclick="eliminarUtilizador('${u.id}', '${u.name.replace(/'/g, "")}')">Eliminar</button>
        `}
      </td>
    </tr>
  `).join("");
}

function marcarOnlineNaTabela(lista) {
  const onlineIds = new Set(lista.map((u) => u.id));
  utilizadoresCache.forEach((u) => (u.online = onlineIds.has(u.id)));
  renderizarUtilizadores();
}

async function alternarPapel(id, papelAtual) {
  const novoPapel = papelAtual === "admin" ? "member" : "admin";
  try {
    await api.patch(`/api/admin/utilizadores/${id}`, { role: novoPapel });
    mostrarToast("Papel atualizado com sucesso.");
    await carregarUtilizadores();
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function alternarEstado(id, ativoAtual) {
  const acao = ativoAtual ? "desativar" : "reativar";
  if (ativoAtual && !confirm("Desativar esta conta termina imediatamente todas as sessões ativas do utilizador. Continuar?")) return;
  try {
    await api.patch(`/api/admin/utilizadores/${id}`, { is_active: !ativoAtual });
    mostrarToast(`Conta ${acao === "desativar" ? "desativada" : "reativada"} com sucesso.`);
    await carregarUtilizadores();
    await carregarEstatisticas();
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function eliminarUtilizador(id, nome) {
  if (!confirm(`Eliminar definitivamente a conta de "${nome}"? Esta ação não pode ser revertida.`)) return;
  try {
    await api.del(`/api/admin/utilizadores/${id}`);
    mostrarToast("Utilizador eliminado.");
    await carregarUtilizadores();
    await carregarEstatisticas();
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function carregarOnline() {
  const lista = await api.get("/api/admin/online");
  renderizarOnline(lista);
}

function renderizarOnline(lista) {
  const container = document.getElementById("lista-online");
  if (lista.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="display">Ninguém online</div>Não há utilizadores ligados neste momento.</div>`;
    return;
  }
  container.innerHTML = lista.map((u) => `
    <div class="project-card" style="cursor:default">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span class="dot-online"></span>
        <h3 style="margin:0;font-size:15.5px">${u.name}</h3>
      </div>
      <p style="margin:0">${u.email}</p>
      <div class="meta" style="margin-top:10px"><span>${u.role === "admin" ? "Administrador" : "Membro"}</span></div>
    </div>
  `).join("");
}

async function carregarProjetos() {
  const projetos = await api.get("/api/admin/projetos");
  document.getElementById("tbody-projetos").innerHTML = projetos.map((p) => `
    <tr>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.team_name || "—"}</td>
      <td>${p.criado_por || "—"}</td>
      <td>${p.total_membros}</td>
      <td>${p.total_tarefas}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(p.created_at).toLocaleDateString("pt-PT")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sem projetos criados ainda.</td></tr>`;
}

async function sair() {
  await api.post("/api/auth/logout");
  sessao.limpar();
  window.location.href = "/entrar.html";
}

// ---------------- Notificações (visão da administração) ----------------
const rotuloTipoNotificacao = {
  "task.assigned": "Tarefa atribuída",
  "comment.new": "Novo comentário",
  "mention": "Menção",
  "project.invited": "Convite para projeto",
  "project.invite": "Convite pendente",
  "project.invite_approval_request": "Pedido de convite (aprovação)",
  "project.invite_approved": "Convite aprovado",
  "project.invite_rejected": "Convite rejeitado",
  "project.invite_accepted": "Convite aceite",
  "project.invite_declined": "Convite recusado",
  "project.left": "Saída de projeto",
  "admin.announcement": "Anúncio da administração",
  "task.file_sent": "Ficheiro enviado ao responsável",
  "meeting.scheduled": "Reunião marcada",
  "meeting.cancelled": "Reunião cancelada",
  "project.made_responsible": "Novo responsável de projeto",
  "automation.triggered": "Automação executada",
  "task.due_tomorrow": "Prazo amanhã",
  "task.due_today": "Prazo hoje",
};

async function carregarNotificacoesAdmin() {
  const d = await api.get("/api/admin/notificacoes");

  document.getElementById("grid-estatisticas-notificacoes").innerHTML = `
    <div class="stat-card"><div class="num">${d.total}</div><div class="label">Notificações no total</div></div>
    <div class="stat-card"><div class="num">${d.nao_lidas}</div><div class="label">Por ler</div></div>
    ${d.por_tipo.map((t) => `
      <div class="stat-card">
        <div class="num">${t.total}</div>
        <div class="label">${(rotulosNotificacao[t.type] || "🔔")} ${rotuloTipoNotificacao[t.type] || t.type}</div>
      </div>
    `).join("")}
  `;

  document.getElementById("tbody-notificacoes").innerHTML = d.recentes.map((n) => `
    <tr>
      <td>${rotulosNotificacao[n.type] || "🔔"} ${rotuloTipoNotificacao[n.type] || n.type}</td>
      <td style="max-width:320px">${n.content}</td>
      <td>
        <div style="font-weight:600">${n.destinatario_nome}</div>
        <div style="font-size:11px;color:var(--ink-faint)">${n.destinatario_email}</div>
      </td>
      <td>${n.projeto_nome || "—"}</td>
      <td><span class="badge-status ${n.is_read ? "ativo" : "inativo"}">${n.is_read ? "Lida" : "Por ler"}</span></td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(n.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Ainda não há notificações registadas.</td></tr>`;
}

// ---------------- Mensagens (anúncios da administração) ----------------
const rotuloDestino = { todos: "Todos os utilizadores", projeto: "Projeto", utilizador: "Utilizador" };

async function carregarMensagens() {
  await popularSelectoresMensagem();

  const mensagens = await api.get("/api/admin/mensagens");
  document.getElementById("tbody-mensagens").innerHTML = mensagens.map((m) => `
    <tr>
      <td style="max-width:340px">${m.content}</td>
      <td>${rotuloDestino[m.audience]}${m.audience === "projeto" ? ` — ${m.projeto_nome || "—"}` : ""}${m.audience === "utilizador" ? ` — ${m.destinatario_nome || "—"}` : ""}</td>
      <td>${m.total_destinatarios}</td>
      <td>${m.remetente_nome || "—"}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(m.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Ainda não foi enviada nenhuma mensagem.</td></tr>`;
}

async function popularSelectoresMensagem() {
  const selProjeto = document.getElementById("mensagem-projeto");
  const selUtilizador = document.getElementById("mensagem-utilizador");
  if (selProjeto.dataset.pronto) return; // já populado — evita pedidos repetidos

  const [projetos] = await Promise.all([api.get("/api/admin/projetos")]);
  selProjeto.innerHTML = projetos.map((p) => `<option value="${p.id}">${p.name}</option>`).join("") || `<option value="">Sem projetos</option>`;
  selUtilizador.innerHTML = utilizadoresCache.map((u) => `<option value="${u.id}">${u.name} (${u.email})</option>`).join("");
  selProjeto.dataset.pronto = "1";
}

function alternarCamposMensagem() {
  const destino = document.getElementById("mensagem-destino").value;
  document.getElementById("campo-mensagem-projeto").style.display = destino === "projeto" ? "block" : "none";
  document.getElementById("campo-mensagem-utilizador").style.display = destino === "utilizador" ? "block" : "none";
}

async function enviarMensagem() {
  const destino = document.getElementById("mensagem-destino").value;
  const conteudo = document.getElementById("mensagem-conteudo").value.trim();
  const projectId = document.getElementById("mensagem-projeto").value;
  const userId = document.getElementById("mensagem-utilizador").value;

  if (!conteudo) { mostrarToast("Escreva uma mensagem antes de enviar."); return; }

  try {
    await api.post("/api/admin/mensagens", { content: conteudo, audience: destino, projectId, userId });
    mostrarToast("Mensagem enviada.");
    document.getElementById("mensagem-conteudo").value = "";
    await carregarMensagens();
    await carregarNotificacoesAdmin();
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Relatórios ----------------
let dadosRelatorioCache = null;

async function carregarDadosRelatorio() {
  try {
    dadosRelatorioCache = await api.get("/api/admin/relatorios/dados");
    renderizarPreviewRelatorios();
  } catch (err) {
    console.error("Erro ao carregar dados do relatório:", err);
  }
}

function renderizarPreviewRelatorios() {
  const d = dadosRelatorioCache;
  if (!d) return;

  // Seletor de projeto
  const selProjeto = document.getElementById("filtro-relatorio-projeto");
  selProjeto.innerHTML = '<option value="">Todos os projetos</option>' +
    d.projetos.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");

  // Pré-visualização: projetos
  document.getElementById("tbody-preview-projetos").innerHTML = d.projetos.map((p) => `
    <tr>
      <td style="font-weight:600">${p.name}</td>
      <td>${p.team_name || "—"}</td>
      <td>${p.criado_por || "—"}</td>
      <td>${p.membros.length}</td>
      <td>${p.tarefas.length}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(p.created_at).toLocaleDateString("pt-PT")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sem projetos.</td></tr>`;

  // Pré-visualização: tarefas por projeto (uma mini-tabela por projeto)
  document.getElementById("preview-tarefas-projetos").innerHTML = d.projetos.map((p) => `
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;color:var(--ink-dim);margin-bottom:8px">${p.name}</div>
      <table class="admin-table">
        <thead><tr><th>Tarefa</th><th>Coluna</th><th>Prioridade</th><th>Responsável</th><th>Etiquetas</th><th>Checklist</th></tr></thead>
        <tbody>
          ${p.tarefas.map((t) => `
            <tr>
              <td>${t.title}</td>
              <td>${t.coluna || "—"}</td>
              <td style="text-transform:capitalize">${t.priority}</td>
              <td>${t.responsavel_nome || "—"}</td>
              <td>${(t.labels || []).map((l) => l.name).join(", ") || "—"}</td>
              <td>${t.checklist_total > 0 ? `${t.checklist_feitos}/${t.checklist_total}` : "—"}</td>
            </tr>
          `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">Sem tarefas.</td></tr>`}
        </tbody>
      </table>
    </div>
  `).join("");

  // Pré-visualização: utilizadores
  document.getElementById("tbody-preview-utilizadores").innerHTML = d.utilizadores.map((u) => `
    <tr>
      <td style="font-weight:600">${u.name}</td>
      <td>${u.email}</td>
      <td><span class="badge-role ${u.role}">${u.role === "admin" ? "Administrador" : "Membro"}</span></td>
      <td>${u.total_projetos}</td>
      <td>${u.tarefas_atribuidas}</td>
      <td>${u.tarefas_criadas}</td>
      <td>${u.total_comentarios}</td>
    </tr>
  `).join("");
}

/**
 * Descarrega o PDF através de fetch (com o cabeçalho Authorization,
 * necessário porque a sessão já não usa cookies) e abre-o numa nova
 * aba — a partir daí, o próprio visualizador de PDF do navegador
 * permite imprimir ou guardar o ficheiro.
 */
async function gerarPDF(tipo) {
  mostrarToast("A gerar PDF…");
  try {
    const projectId = document.getElementById("filtro-relatorio-projeto")?.value || "";
    let url = `/api/admin/relatorios/pdf?tipo=${tipo}`;
    if (tipo === "projetos" && projectId) url += `&projectId=${projectId}`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${sessao.obterToken()}` } });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      mostrarToast(d.erro || "Erro ao gerar o relatório.");
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank");
  } catch (err) {
    mostrarToast("Erro ao gerar PDF: " + err.message);
  }
}

/** Descarrega a exportação CSV (Excel/Google Sheets) do tipo indicado. */
async function exportarCSV(tipo) {
  try {
    const res = await fetch(`/api/admin/relatorios/csv?tipo=${tipo}`, {
      headers: { Authorization: `Bearer ${sessao.obterToken()}` },
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      mostrarToast(d.erro || "Erro ao exportar dados.");
      return;
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `gpitrack-${tipo}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    mostrarToast("Exportação CSV descarregada.");
  } catch (err) {
    mostrarToast("Erro ao exportar CSV: " + err.message);
  }
}

// ---------------- Feedback ----------------
async function carregarFeedback() {
  const lista = await api.get("/api/admin/feedback");
  document.getElementById("lista-feedback").innerHTML = lista.map((f) => `
    <div class="report-card" style="margin-bottom:10px;${f.is_read ? "opacity:.65" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div style="font-size:12.5px;color:var(--ink-dim);margin-bottom:6px">
            <b>${f.name || "Anónimo"}</b>${f.email ? ` · ${f.email}` : ""}
            · <span style="color:var(--ink-faint)">${f.page === "home" ? "página inicial" : f.page === "espaco-gestao" ? "espaço de gestão" : "—"}</span>
            · <span style="color:var(--ink-faint)">${new Date(f.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <div style="font-size:13.5px;white-space:pre-wrap">${f.message}</div>
        </div>
        ${!f.is_read ? `<span class="mini-btn" onclick="marcarFeedbackLido('${f.id}')">Marcar como lido</span>` : ""}
      </div>
    </div>
  `).join("") || `<div class="sub">Ainda não chegou nenhum feedback.</div>`;
}

async function marcarFeedbackLido(id) {
  await api.patch(`/api/admin/feedback/${id}/lida`, {});
  await carregarFeedback();
}

iniciar();
