let eu = null;
let socket = null;

const rotuloTabs = {
  "visao-geral": "tab-visao-geral", "equipas": "tab-equipas", "projetos": "tab-projetos",
  "tarefas": "tab-tarefas", "membros": "tab-membros", "relatorios": "tab-relatorios", "reunioes": "tab-reunioes",
  "feedback": "tab-feedback",
};
const rotuloPrioridade = { alta: "🔴 Alta", media: "🟡 Média", baixa: "🟢 Baixa" };

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

  document.getElementById("user-chip").innerHTML = `
    <div class="avatar" style="background:#22C7DD">${iniciais(eu.name)}</div>
    <div class="who">${eu.name}<small>${eu.email}</small></div>
    <div class="logout-link" onclick="sair()">Saír</div>
  `;
  if (eu.role === "admin") document.getElementById("nav-admin").style.display = "block";

  // Se veio de dentro de um projeto (ex.: clicou em "Espaço de gestão" a partir
  // do quadro), "Voltar" deve levar de volta a esse projeto, não à lista de projetos.
  const voltarProjeto = new URLSearchParams(window.location.search).get("voltar");
  if (voltarProjeto) {
    document.getElementById("link-voltar").setAttribute("onclick", `location.href='/board.html?projeto=${voltarProjeto}'`);
  }

  socket = io({ auth: { token: sessao.obterToken() } });
  iniciarNotificacoes(socket);

  ligarNavegacao();
  ligarPesquisaLista("pesquisa-equipas", "lista-equipas");
  ligarPesquisaLista("pesquisa-projetos", "tbody-meus-projetos");
  ligarPesquisaLista("pesquisa-tarefas", "tbody-minhas-tarefas");
  ligarPesquisaLista("pesquisa-membros", "lista-membros-por-projeto");
  ligarPesquisaLista("pesquisa-reunioes", "lista-reunioes-futuras");
  ligarPesquisaLista("pesquisa-reunioes", "lista-reunioes-passadas");
  document.getElementById("link-exportar-csv").href = `/api/workspace/relatorios/exportar.csv?token=${encodeURIComponent(sessao.obterToken())}`;

  try {
    await Promise.all([
      carregarVisaoGeral(),
      carregarEquipas(),
      carregarMeusProjetos(),
      carregarMinhasTarefas(),
      carregarMembros(),
      carregarRelatorioPessoal(),
      carregarGraficos(),
      carregarReunioes(),
    ]);
  } catch (err) {
    if (err.status === 403) {
      // Só responsáveis de projeto e administradores têm acesso a este espaço —
      // um membro comum que chegue aqui diretamente é reencaminhado com aviso.
      mostrarToast(err.message || "Sem acesso ao Espaço de Gestão.");
      window.location.href = voltarProjeto ? `/board.html?projeto=${voltarProjeto}` : "/projetos.html";
      return;
    }
    // Qualquer outro erro (ex.: falha no servidor) fica visível em vez de
    // expulsar a pessoa silenciosamente — mais fácil de diagnosticar.
    console.error("Erro ao carregar o Espaço de Gestão:", err);
    mostrarToast(`Não foi possível carregar tudo: ${err.message}`);
  }

  // Se veio de uma notificação de reunião (?aba=reunioes), abre logo essa aba
  const abaAlvo = new URLSearchParams(window.location.search).get("aba");
  if (abaAlvo && rotuloTabs[abaAlvo]) {
    document.querySelector(`.admin-nav-item[data-tab="${abaAlvo}"]`)?.click();
  }
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

async function sair() {
  await api.post("/api/auth/logout");
  sessao.limpar();
  window.location.href = "/entrar.html";
}

// ---------------- Visão geral ----------------
async function carregarVisaoGeral() {
  const [r, reunioes] = await Promise.all([
    api.get("/api/workspace/relatorios"),
    api.get("/api/workspace/reunioes"),
  ]);
  document.getElementById("grid-visao-geral").innerHTML = `
    <div class="stat-card"><div class="num">${r.total_projetos}</div><div class="label">Projetos de que faço parte</div></div>
    <div class="stat-card"><div class="num">${r.total_tarefas}</div><div class="label">Tarefas atribuídas a mim</div></div>
    <div class="stat-card"><div class="num">${r.tarefas_concluidas}</div><div class="label">Concluídas</div></div>
    <div class="stat-card"><div class="num">${r.tarefas_atrasadas}</div><div class="label">Em atraso</div></div>
  `;
  const futuras = reunioes.filter((m) => new Date(m.scheduled_at) >= new Date()).slice(0, 3);
  document.getElementById("visao-geral-reunioes").innerHTML = futuras.length
    ? futuras.map(cartaoReuniao).join("")
    : `<div class="sub">Sem reuniões marcadas para os próximos dias.</div>`;
}

// ---------------- Equipas ----------------
async function carregarEquipas() {
  const equipas = await api.get("/api/workspace/equipas");
  document.getElementById("lista-equipas").innerHTML = equipas.map((t) => `
    <div class="project-card" style="cursor:default">
      <h3>👥 ${t.name}</h3>
      <p>${(t.nomes_projetos || []).filter(Boolean).join(", ") || "Sem projetos associados"}</p>
      <div class="meta">
        <span>${t.total_membros} membro${t.total_membros === 1 ? "" : "s"}</span>
        <span>${t.total_projetos} projeto${t.total_projetos === 1 ? "" : "s"}</span>
      </div>
    </div>
  `).join("") || `<div class="sub">Ainda não faz parte de nenhuma equipa.</div>`;
}

// ---------------- Projetos ----------------
async function carregarMeusProjetos() {
  const projetos = await api.get("/api/projects");
  document.getElementById("tbody-meus-projetos").innerHTML = projetos.map((p) => `
    <tr>
      <td style="font-weight:600">${p.name}</td>
      <td style="color:var(--ink-dim)">${p.description || "—"}</td>
      <td>${p.total_tarefas}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(p.created_at).toLocaleDateString("pt-PT")}</td>
      <td><span class="mini-btn" onclick="location.href='/board.html?projeto=${p.id}'">Abrir quadro →</span></td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Ainda não tem projetos.</td></tr>`;
}

// ---------------- Minhas tarefas ----------------
async function carregarMinhasTarefas() {
  const tarefas = await api.get("/api/workspace/tarefas");
  document.getElementById("tbody-minhas-tarefas").innerHTML = tarefas.map((t) => `
    <tr style="cursor:pointer" onclick="location.href='/board.html?projeto=${t.project_id}&tarefa=${t.id}'">
      <td style="font-weight:600">${t.title}</td>
      <td>${t.projeto_nome}</td>
      <td>${t.coluna_nome}</td>
      <td>${rotuloPrioridade[t.priority] || t.priority}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${t.due_date ? new Date(t.due_date).toLocaleDateString("pt-PT") : "—"}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Sem tarefas atribuídas a si.</td></tr>`;
}

// ---------------- Membros ----------------
async function carregarMembros() {
  const grupos = await api.get("/api/workspace/membros");
  document.getElementById("lista-membros-por-projeto").innerHTML = grupos.map((g) => `
    <div class="report-card" style="margin-bottom:16px">
      <h3>🗂️ ${g.projeto_nome}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px">
        ${g.membros.map((m) => `
          <div style="display:flex;align-items:center;gap:8px;background:var(--navy-900);border:1px solid var(--border);border-radius:10px;padding:8px 12px">
            <div class="avatar" style="width:26px;height:26px;font-size:11px;background:${m.avatar_color || "#22C7DD"}">${iniciais(m.name)}</div>
            <div>
              <div style="font-size:12.5px;font-weight:600">${m.name}${m.responsavel ? " · <span style='color:var(--cyan)'>responsável</span>" : ""}</div>
              <div style="font-size:11px;color:var(--ink-faint)">${m.email}</div>
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("") || `<div class="sub">Ainda não tem colegas de equipa.</div>`;
}

// ---------------- Gráficos (dashboard pessoal) ----------------
const CHART_CYAN = "#22C7DD";
const CHART_CYAN_DIM = "rgba(34,199,221,0.18)";
const CHART_CORES = ["#22C7DD", "#F0B429", "#34C77B", "#EF6461", "#8E7CC3", "#E67E22"];
const CHART_GRID = "rgba(255,255,255,0.06)";

let graficosAtivos = {};
function desenharGrafico(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (typeof Chart === "undefined") return;
  if (graficosAtivos[id]) graficosAtivos[id].destroy();
  graficosAtivos[id] = new Chart(canvas.getContext("2d"), config);
}

async function carregarGraficos() {
  Chart.defaults.color = "#8A96AE";
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size = 11.5;

  const d = await api.get("/api/workspace/dashboard");

  desenharGrafico("chart-tarefas-dia", {
    type: "line",
    data: { labels: d.tarefas_por_dia.map((r) => r.dia), datasets: [{
      data: d.tarefas_por_dia.map((r) => r.total), borderColor: CHART_CYAN, backgroundColor: CHART_CYAN_DIM,
      fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2,
    }] },
    options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { grid: { color: CHART_GRID }, beginAtZero: true, ticks: { precision: 0 } } } },
  });

  desenharGrafico("chart-prioridade", {
    type: "doughnut",
    data: {
      labels: d.tarefas_por_prioridade.map((r) => rotuloPrioridade[r.priority] || r.priority),
      datasets: [{ data: d.tarefas_por_prioridade.map((r) => r.total), backgroundColor: CHART_CORES, borderColor: "#111A2E", borderWidth: 2 }],
    },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 14 } } } },
  });

  desenharGrafico("chart-colunas", {
    type: "doughnut",
    data: { labels: d.tarefas_por_coluna.map((r) => r.coluna), datasets: [{
      data: d.tarefas_por_coluna.map((r) => r.total), backgroundColor: CHART_CORES, borderColor: "#111A2E", borderWidth: 2,
    }] },
    options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 14 } } } },
  });

  desenharGrafico("chart-projetos", {
    type: "bar",
    data: { labels: d.top_projetos.map((r) => r.projeto), datasets: [{
      data: d.top_projetos.map((r) => r.total), backgroundColor: CHART_CYAN, borderRadius: 5, maxBarThickness: 34,
    }] },
    options: { indexAxis: "y", plugins: { legend: { display: false } }, scales: { x: { grid: { color: CHART_GRID }, beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } } },
  });
}

// ---------------- Relatórios ----------------
async function carregarRelatorioPessoal() {
  const r = await api.get("/api/workspace/relatorios");
  document.getElementById("grid-relatorio-pessoal").innerHTML = `
    <div class="stat-card"><div class="num">${r.total_tarefas}</div><div class="label">Tarefas no total</div></div>
    <div class="stat-card"><div class="num">${r.tarefas_concluidas}</div><div class="label">Concluídas</div></div>
    <div class="stat-card"><div class="num">${r.tarefas_atrasadas}</div><div class="label">Em atraso</div></div>
    ${r.por_prioridade.map((p) => `<div class="stat-card"><div class="num">${p.total}</div><div class="label">${rotuloPrioridade[p.priority] || p.priority}</div></div>`).join("")}
  `;
}

// ---------------- Reuniões ----------------
function cartaoReuniao(m) {
  const data = new Date(m.scheduled_at);
  const podeCancelar = eu.role === "admin" || m.created_by === eu.id;
  return `
    <div class="report-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <h3 style="margin-bottom:4px">🗓️ ${m.title}</h3>
          <div style="font-size:12.5px;color:var(--ink-dim)">${m.projeto_nome} · ${data.toLocaleString("pt-PT", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
          ${m.location ? `<div style="font-size:12px;color:var(--ink-faint);margin-top:4px">📍 ${m.location}</div>` : ""}
          ${m.description ? `<div style="font-size:12.5px;color:var(--ink-dim);margin-top:8px">${m.description}</div>` : ""}
          <div style="font-size:11px;color:var(--ink-faint);margin-top:8px">Marcada por ${m.criado_por_nome || "—"}</div>
        </div>
        ${podeCancelar ? `<span class="mini-btn danger" onclick="cancelarReuniao('${m.id}')">Cancelar</span>` : ""}
      </div>
    </div>
  `;
}

async function carregarReunioes() {
  const projetos = await api.get("/api/projects");
  const selProjeto = document.getElementById("reuniao-projeto");
  selProjeto.innerHTML = projetos.map((p) => `<option value="${p.id}">${p.name}</option>`).join("") || `<option value="">Sem projetos</option>`;

  const reunioes = await api.get("/api/workspace/reunioes");
  const agora = new Date();
  const futuras = reunioes.filter((m) => new Date(m.scheduled_at) >= agora);
  const passadas = reunioes.filter((m) => new Date(m.scheduled_at) < agora).reverse();

  document.getElementById("lista-reunioes-futuras").innerHTML = futuras.map(cartaoReuniao).join("") || `<div class="sub">Sem reuniões marcadas.</div>`;
  document.getElementById("lista-reunioes-passadas").innerHTML = passadas.map(cartaoReuniao).join("") || `<div class="sub">Ainda sem histórico.</div>`;
}

async function marcarReuniao() {
  const project_id = document.getElementById("reuniao-projeto").value;
  const title = document.getElementById("reuniao-titulo").value.trim();
  const scheduled_at = document.getElementById("reuniao-data").value;
  const location = document.getElementById("reuniao-local").value.trim();
  const description = document.getElementById("reuniao-descricao").value.trim();

  if (!project_id || !title || !scheduled_at) {
    mostrarToast("Escolha o projeto, o título e a data/hora.");
    return;
  }

  try {
    await api.post("/api/workspace/reunioes", { project_id, title, scheduled_at, location, description });
    mostrarToast("Reunião marcada — a equipa foi notificada.");
    document.getElementById("reuniao-titulo").value = "";
    document.getElementById("reuniao-data").value = "";
    document.getElementById("reuniao-local").value = "";
    document.getElementById("reuniao-descricao").value = "";
    await carregarReunioes();
    await carregarVisaoGeral();
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function cancelarReuniao(id) {
  if (!confirm("Cancelar esta reunião? A equipa será notificada.")) return;
  try {
    await api.del(`/api/workspace/reunioes/${id}`);
    mostrarToast("Reunião cancelada.");
    await carregarReunioes();
    await carregarVisaoGeral();
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Feedback ----------------
async function enviarFeedbackWorkspace() {
  const mensagem = document.getElementById("feedback-mensagem").value.trim();
  if (!mensagem) { mostrarToast("Escreva uma mensagem antes de enviar."); return; }
  try {
    await api.post("/api/feedback", { name: eu.name, email: eu.email, message: mensagem, page: "espaco-gestao" });
    document.getElementById("feedback-mensagem").value = "";
    mostrarToast("Obrigado! O seu feedback foi enviado.");
  } catch (err) {
    mostrarToast(err.message);
  }
}

iniciar();
