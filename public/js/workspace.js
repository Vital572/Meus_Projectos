let eu = null;
let socket = null;

const rotuloTabs = {
  "visao-geral": "tab-visao-geral", "equipas": "tab-equipas", "projetos": "tab-projetos",
  "tarefas": "tab-tarefas", "semana": "tab-semana", "membros": "tab-membros", "atividades": "tab-atividades",
  "relatorios": "tab-relatorios", "reunioes": "tab-reunioes", "feedback": "tab-feedback",
};
const rotuloPrioridade = { alta: "🔴 Alta", media: "🟡 Média", baixa: "🟢 Baixa" };
const ROTULO_ACAO_ATIVIDADE = {
  "task.created": "criou a tarefa",
  "task.updated": "atualizou a tarefa",
  "task.moved": "moveu uma tarefa",
  "comment.created": "comentou numa tarefa",
};

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
  ligarPesquisaLista("pesquisa-projetos", "tbody-projetos-responsavel");
  ligarPesquisaLista("pesquisa-projetos", "tbody-projetos-convidado");
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
      carregarSemana(),
      carregarMembros(),
      carregarAtividadesWorkspace(),
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

  // Preferência: notificações por e-mail
  const caixaEmail = document.getElementById("pref-email-notificacoes");
  caixaEmail.checked = eu.email_notificacoes !== false;
  caixaEmail.onchange = async () => {
    try {
      await api.patch("/api/auth/preferencias", { email_notificacoes: caixaEmail.checked });
      mostrarToast(caixaEmail.checked ? "Notificações por e-mail ativadas." : "Notificações por e-mail desativadas.");
    } catch (err) {
      caixaEmail.checked = !caixaEmail.checked;
      mostrarToast(err.message);
    }
  };

  // Segurança: mostra o bloco certo consoante a 2FA já esteja ativa ou não
  document.getElementById("bloco-mfa-ativado").style.display = eu.mfa_enabled ? "flex" : "none";
  document.getElementById("bloco-mfa-desativado").style.display = eu.mfa_enabled ? "none" : "flex";
}

// ---------------- Autenticação de dois fatores (2FA / TOTP) ----------------
async function iniciarConfigMFA() {
  try {
    const { secret, qrCodeDataUrl } = await api.get("/api/auth/mfa/configurar");
    document.getElementById("mfa-qrcode").innerHTML = `<img src="${qrCodeDataUrl}" alt="QR code" style="border-radius:10px;background:#fff;padding:8px" />`;
    document.getElementById("mfa-chave-manual").value = secret;
    document.getElementById("mfa-codigo-ativar").value = "";
    document.getElementById("erro-mfa-ativar").style.display = "none";
    document.getElementById("overlay-config-mfa").classList.add("open");
  } catch (err) {
    mostrarToast(err.message);
  }
}
function fecharModalConfigMFA() {
  document.getElementById("overlay-config-mfa").classList.remove("open");
}
async function confirmarAtivarMFA() {
  const code = document.getElementById("mfa-codigo-ativar").value.trim();
  const erroBox = document.getElementById("erro-mfa-ativar");
  erroBox.style.display = "none";
  if (!code) { erroBox.textContent = "Indique o código de 6 dígitos."; erroBox.style.display = "block"; return; }
  try {
    await api.post("/api/auth/mfa/ativar", { code });
    eu.mfa_enabled = true;
    fecharModalConfigMFA();
    document.getElementById("bloco-mfa-ativado").style.display = "flex";
    document.getElementById("bloco-mfa-desativado").style.display = "none";
    mostrarToast("Autenticação de dois fatores ativada.");
  } catch (err) {
    erroBox.textContent = err.message;
    erroBox.style.display = "block";
  }
}

function abrirModalDesativarMFA() {
  document.getElementById("mfa-codigo-desativar").value = "";
  document.getElementById("erro-mfa-desativar").style.display = "none";
  document.getElementById("overlay-desativar-mfa").classList.add("open");
}
function fecharModalDesativarMFA() {
  document.getElementById("overlay-desativar-mfa").classList.remove("open");
}
async function confirmarDesativarMFA() {
  const valor = document.getElementById("mfa-codigo-desativar").value.trim();
  const erroBox = document.getElementById("erro-mfa-desativar");
  erroBox.style.display = "none";
  if (!valor) { erroBox.textContent = "Indique o código ou a sua password."; erroBox.style.display = "block"; return; }
  // Um código TOTP tem sempre 6 dígitos; qualquer outra coisa é tratada como password.
  const payload = /^\d{6}$/.test(valor) ? { code: valor } : { password: valor };
  try {
    await api.post("/api/auth/mfa/desativar", payload);
    eu.mfa_enabled = false;
    fecharModalDesativarMFA();
    document.getElementById("bloco-mfa-ativado").style.display = "none";
    document.getElementById("bloco-mfa-desativado").style.display = "flex";
    mostrarToast("Autenticação de dois fatores desativada.");
  } catch (err) {
    erroBox.textContent = err.message;
    erroBox.style.display = "block";
  }
}

// ---------------- Equipas ----------------
async function carregarEquipas() {
  const equipas = await api.get("/api/workspace/equipas");
  document.getElementById("lista-equipas").innerHTML = equipas.map((t) => `
    <div class="project-card" style="cursor:default">
      <h3>👥 ${t.name}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0">
        ${(t.projetos || []).filter((p) => p && p.id).map((p) => `
          <span class="mini-btn" style="cursor:pointer" onclick="location.href='/board.html?projeto=${p.id}'">🗂️ ${p.name}</span>
        `).join("") || `<span class="sub" style="margin:0">Sem projetos associados</span>`}
      </div>
      <div class="meta">
        <span>${t.total_membros} membro${t.total_membros === 1 ? "" : "s"}</span>
        <span>${t.total_projetos} projeto${t.total_projetos === 1 ? "" : "s"}</span>
      </div>
    </div>
  `).join("") || `<div class="sub">Ainda não faz parte de nenhuma equipa.</div>`;
}

// ---------------- Projetos ----------------
function linhaProjeto(p) {
  return `
    <tr style="cursor:pointer" onclick="location.href='/board.html?projeto=${p.id}'">
      <td style="font-weight:600">${p.name}</td>
      <td style="color:var(--ink-dim)">${p.description || "—"}</td>
      <td>${p.total_tarefas}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${new Date(p.created_at).toLocaleDateString("pt-PT")}</td>
      <td><span class="mini-btn" onclick="event.stopPropagation();location.href='/board.html?projeto=${p.id}'">Abrir quadro →</span></td>
    </tr>`;
}

async function carregarMeusProjetos() {
  const projetos = await api.get("/api/projects");
  const responsavel = projetos.filter((p) => p.meu_papel === "responsavel");
  const convidado = projetos.filter((p) => p.meu_papel !== "responsavel");

  document.getElementById("tbody-projetos-responsavel").innerHTML = responsavel.map(linhaProjeto).join("") ||
    `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Ainda não é responsável por nenhum projeto.</td></tr>`;
  document.getElementById("tbody-projetos-convidado").innerHTML = convidado.map(linhaProjeto).join("") ||
    `<tr><td colspan="5" style="text-align:center;color:var(--ink-faint)">Ainda não foi convidado para nenhum projeto.</td></tr>`;
}

// ---------------- Atividades recentes ----------------
async function carregarAtividadesWorkspace() {
  const eventos = await api.get("/api/workspace/atividades");
  document.getElementById("lista-atividades-workspace").innerHTML = eventos.map((e) => `
    <div class="report-card" style="margin-bottom:10px;display:flex;align-items:center;gap:12px">
      <div class="avatar" style="width:30px;height:30px;font-size:12px;background:${e.avatar_color || "#22C7DD"}">${iniciais(e.user_name || "?")}</div>
      <div style="flex:1">
        <div style="font-size:13px"><strong>${e.user_name || "Alguém"}</strong> ${ROTULO_ACAO_ATIVIDADE[e.action] || e.action}</div>
        <div style="font-size:11.5px;color:var(--ink-faint)">${e.projeto_nome} · ${new Date(e.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      <span class="mini-btn" onclick="location.href='/board.html?projeto=${e.project_id}'">Ver projeto →</span>
    </div>
  `).join("") || `<div class="sub">Sem atividade recente nos seus projetos.</div>`;
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

// ---------------- Minha semana (Asana) ----------------
// Agrupa as mesmas tarefas de "/api/workspace/tarefas" por prazo: atrasadas,
// um grupo por cada um dos próximos 7 dias, e por fim as sem prazo definido.
// Tarefas já concluídas (coluna "is_done") não aparecem aqui — já cumpriram
// o prazo que tinham.
async function carregarSemana() {
  const todas = (await api.get("/api/workspace/tarefas")).filter((t) => !t.is_done);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const seteDias = new Date(hoje);
  seteDias.setDate(seteDias.getDate() + 7);

  const atrasadas = [];
  const semPrazo = [];
  const porDia = new Map(); // "YYYY-MM-DD" -> [tarefas]

  todas.forEach((t) => {
    if (!t.due_date) { semPrazo.push(t); return; }
    const d = new Date(t.due_date);
    d.setHours(0, 0, 0, 0);
    if (d < hoje) { atrasadas.push(t); return; }
    if (d <= seteDias) {
      const chave = d.toISOString().slice(0, 10);
      if (!porDia.has(chave)) porDia.set(chave, []);
      porDia.get(chave).push(t);
    }
    // Prazos a mais de 7 dias não aparecem em "Minha semana".
  });

  const linhaTarefa = (t) => `
    <div class="semana-tarefa" onclick="location.href='/board.html?projeto=${t.project_id}&tarefa=${t.id}'">
      <span class="semana-tarefa-titulo">${t.title}</span>
      <span class="semana-tarefa-meta">${t.projeto_nome} · ${rotuloPrioridade[t.priority] || t.priority}</span>
    </div>`;

  document.getElementById("semana-atrasadas").innerHTML = atrasadas.length ? `
    <div class="report-card" style="margin-bottom:16px;border-color:var(--danger)">
      <h3 style="color:var(--danger)">⏰ Atrasadas (${atrasadas.length})</h3>
      ${atrasadas.map(linhaTarefa).join("")}
    </div>` : "";

  const diasOrdenados = [...porDia.keys()].sort();
  document.getElementById("semana-dias").innerHTML = diasOrdenados.map((chave) => {
    const d = new Date(chave + "T00:00:00");
    const rotulo = d.getTime() === hoje.getTime()
      ? "Hoje"
      : d.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "short" });
    return `
      <div class="report-card" style="margin-bottom:16px">
        <h3 style="text-transform:capitalize">📅 ${rotulo}</h3>
        ${porDia.get(chave).map(linhaTarefa).join("")}
      </div>`;
  }).join("") || (atrasadas.length ? "" : `<div class="sub">Sem tarefas com prazo nos próximos 7 dias. 🎉</div>`);

  document.getElementById("semana-sem-prazo").innerHTML = semPrazo.length ? `
    <div class="report-card" style="opacity:.8">
      <h3>📋 Sem prazo definido (${semPrazo.length})</h3>
      ${semPrazo.map(linhaTarefa).join("")}
    </div>` : "";
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
