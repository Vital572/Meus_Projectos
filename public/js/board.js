const params = new URLSearchParams(window.location.search);
const projectId = params.get("projeto");

let eu = null;
let socket = null;
let estado = { colunas: [], tarefas: [], membros: [], projeto: null };
let etiquetasProjeto = [];
let tarefaAtiva = null;
let anexosAtivos = [];
let etiquetasSelecionadasNaTarefaNova = new Set();
let timeoutDigitando = null;
let filtroTexto = "";
let filtroResponsavel = "";
let filtroEtiqueta = "";
let projetosDoUtilizador = [];
let timeoutDigitandoCanal = null;
let mensagensCanalCache = [];
let gruposCanal = [];
let grupoAtivo = null; // null = conversa geral
const gruposNaoLidos = new Set(); // 'geral' ou id do grupo com mensagens novas
let modoSelecao = false;
const mensagensSelecionadas = new Set();
let fixadasAbertas = false;
let camposPersonalizadosProjeto = [];
let intervaloCronometro = null;

const cores = ["#22C7DD", "#F0B429", "#8E44AD", "#34C77B", "#EF6461"];
function corPara(id) {
  let hash = 0;
  for (const c of id) hash += c.charCodeAt(0);
  return cores[hash % cores.length];
}

// ---------------- Permissões (auxiliar visual — o servidor é sempre a autoridade final) ----------------
// Pequena celebração ao mover uma tarefa para a coluna concluída — inspirado
// na animação de conclusão de tarefas do Asana.
function celebrarConclusao() {
  const cores = ["#FC636B", "#22C7DD", "#FFCB00", "#00C875", "#A25DDC"];
  const container = document.createElement("div");
  container.className = "confetti-container";
  for (let i = 0; i < 26; i++) {
    const peca = document.createElement("span");
    peca.className = "confetti-piece";
    peca.style.left = `${Math.random() * 100}vw`;
    peca.style.background = cores[i % cores.length];
    peca.style.animationDelay = `${Math.random() * 0.25}s`;
    peca.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(peca);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 1600);
}

function souDonoDoProjeto() {
  return !!estado.projeto && (eu.role === "admin" || !!estado.sou_responsavel);
}
function podeGerirTarefa(t) {
  return eu.role === "admin" || t.created_by === eu.id || souDonoDoProjeto();
}

async function iniciar() {
  if (!projectId) { window.location.href = "/projetos.html"; return; }

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
    <div class="avatar" style="background:${corPara(eu.id)}">${iniciais(eu.name)}</div>
    <div class="who">${eu.name}<small>${eu.email}</small></div>
    <div class="logout-link" onclick="sair()">Saír</div>
  `;
  if (eu.role === "admin") document.getElementById("nav-admin").style.display = "block";

  try {
    await carregarQuadro();
  } catch (err) {
    console.error("Erro ao carregar o quadro:", err);
    mostrarToast("Não foi possível carregar o quadro. Verifique se aplicou db/migration_v2.sql à base de dados.");
  }

  if (eu.role === "admin" || souDonoDoProjeto()) document.getElementById("bloco-espaco-gestao").style.display = "block";
  if (souDonoDoProjeto()) document.getElementById("bloco-campos-personalizados").style.display = "block";

  try {
    await carregarEtiquetas();
  } catch (err) {
    console.error("Erro ao carregar etiquetas:", err);
  }

  conectarSocket();
  ligarFormularios();
  ligarFiltros();
  ligarControlosProjeto();
  ligarSeletorVistas();

  if (params.get("reunioes")) {
    abrirReunioesProjeto();
    window.history.replaceState({}, "", `/board.html?projeto=${projectId}`);
  }

  // Se veio de uma notificação (ex.: "foi-lhe atribuída esta tarefa"),
  // abre diretamente o detalhe dela em vez de deixar a pessoa à procura.
  const tarefaAlvo = params.get("tarefa");
  if (tarefaAlvo) {
    if (estado.tarefas.some((t) => t.id === tarefaAlvo)) {
      abrirModalDetalhe(tarefaAlvo);
    } else {
      mostrarToast("Essa tarefa já não existe ou foi movida.");
    }
    // Limpa o parâmetro do URL para não a reabrir se a pessoa recarregar a página
    window.history.replaceState({}, "", `/board.html?projeto=${projectId}`);
  }
}

async function carregarQuadro(silencioso = false) {
  const projetos = await api.get("/api/projects");
  const projetoAtual = projetos.find((p) => p.id === projectId);
  document.getElementById("nome-projeto").textContent = projetoAtual ? projetoAtual.name : "Projeto";
  document.getElementById("desc-projeto").textContent = projetoAtual?.description || "";
  document.getElementById("channel-nome-projeto").textContent = projetoAtual ? projetoAtual.name : "";

  projetosDoUtilizador = projetos;
  document.getElementById("ps-nome-atual").textContent = projetoAtual ? projetoAtual.name : "Projeto";
  renderizarSeletorProjetos();

  estado = await api.get(`/api/projects/${projectId}/quadro`);

  const btnMeta = document.getElementById("btn-nova-meta");
  if (btnMeta) btnMeta.style.display = souDonoDoProjeto() ? "" : "none";
  if (souDonoDoProjeto()) {
    document.getElementById("btn-editar-projeto").style.display = "inline";
    document.getElementById("btn-eliminar-projeto").style.display = "inline";
  }

  const selResp = document.getElementById("nt-responsavel");
  selResp.innerHTML = '<option value="">Sem responsável</option>' +
    estado.membros.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

  const filtroResp = document.getElementById("filtro-responsavel");
  filtroResp.innerHTML = '<option value="">Todos os responsáveis</option>' +
    estado.membros.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

  const etResp = document.getElementById("et-responsavel");
  if (etResp) etResp.innerHTML = '<option value="">Sem responsável</option>' +
    estado.membros.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

  renderizarMembros();
  renderizarQuadro();
  carregarPedidosConvite();
  iniciarNavegacaoQuadro();
  if (!silencioso && window.animarEntrada) animarEntrada();
}

function renderizarMembros() {
  if (document.getElementById("view-equipa")?.style.display !== "none") renderizarEquipa();
  const souGestor = souDonoDoProjeto();
  const lista = document.getElementById("lista-membros");
  const nOnline = estado.membros.filter((m) => idsOnline.has(m.id)).length;
  const rotulo = document.getElementById("membros-resumo");
  if (rotulo) rotulo.textContent = `${estado.membros.length} · ${nOnline} online`;
  // Online primeiro, depois por nome.
  const ordenados = [...estado.membros].sort((a, b) => (idsOnline.has(b.id) - idsOnline.has(a.id)) || a.name.localeCompare(b.name));
  lista.innerHTML = ordenados.map((m) => {
    const online = idsOnline.has(m.id);
    const nivel = m.role === "responsavel" ? "Responsável" : "Membro";
    return `
    <div class="membro-linha membro-lateral">
      <div class="avatar-wrap" onclick="abrirPerfilMembro('${m.id}')" role="button" tabindex="0" title="${m.id === eu.id ? "O meu perfil" : "Ver perfil"}">
        <div class="avatar" style="width:26px;height:26px;font-size:10.5px;background:${corPara(m.id)}">${iniciais(m.name)}</div>
        <span class="ponto-estado ${online ? "on" : ""}" title="${online ? "Online" : "Offline"}"></span>
      </div>
      <div class="membro-info" onclick="abrirPerfilMembro('${m.id}')" title="${escaparHtml(m.name)} — ${nivel}${online ? " · online" : ""}">
        <div class="membro-nome">${escaparHtml(m.name)}${m.id === eu.id ? " <em>(eu)</em>" : ""}${m.role === "responsavel" ? " 👑" : ""}</div>
        <div class="membro-sub">${nivel} · ${online ? "online" : "offline"}</div>
      </div>
      ${souGestor ? `
        <label class="membro-resp" title="Tornar responsável do projeto">
          <input type="checkbox" ${m.role === "responsavel" ? "checked" : ""} onchange="alternarResponsavel('${m.id}', this.checked)" style="accent-color:var(--cyan);cursor:pointer" />
          Resp.
        </label>` : ""}
    </div>`;
  }).join("");
}

// Convites respondidos nas notificações (🔔) → atualiza o contador de pedidos
window.addEventListener("convites:alterados", () => { carregarPedidosConvite(); });

// ---------------- Pedidos de convite para aprovar (responsáveis) ----------------
let pedidosConvite = [];
async function carregarPedidosConvite() {
  const bloco = document.getElementById("bloco-pedidos-convite");
  if (!bloco) return;
  if (!souDonoDoProjeto()) { bloco.style.display = "none"; return; }
  try {
    const todos = await api.get("/api/projects/convites/para-aprovar");
    pedidosConvite = todos.filter((p) => p.projeto_id === projectId);
  } catch { pedidosConvite = []; }
  bloco.style.display = "block";
  const badge = document.getElementById("badge-pedidos");
  badge.textContent = pedidosConvite.length;
  badge.style.display = pedidosConvite.length ? "inline-block" : "none";
  if (document.getElementById("overlay-pedidos").classList.contains("open")) desenharPedidosConvite();
}
function desenharPedidosConvite() {
  Convites.listaAprovar(document.getElementById("pedidos-lista"), pedidosConvite, async () => { await carregarPedidosConvite(); desenharPedidosConvite(); }, "Não há pedidos de convite à espera de aprovação.");
}
async function abrirPedidosConvite() {
  await carregarPedidosConvite();
  desenharPedidosConvite();
  document.getElementById("overlay-pedidos").classList.add("open");
}
function fecharPedidosConvite() { document.getElementById("overlay-pedidos").classList.remove("open"); }

// ---------------- Reuniões do projeto (para todos os membros) ----------------
async function abrirReunioesProjeto() {
  const lista = document.getElementById("reunioes-projeto-lista");
  lista.innerHTML = `<div class="sub">A carregar…</div>`;
  document.getElementById("overlay-reunioes").classList.add("open");
  const gerir = document.getElementById("reunioes-projeto-gerir");
  gerir.style.display = souDonoDoProjeto() ? "block" : "none";
  document.getElementById("reunioes-gerir-link").href = `/workspace.html?projeto=${projectId}&aba=reunioes&voltar=${projectId}`;
  try {
    const todas = await api.get(`/api/projects/${projectId}/reunioes`);
    const agora = new Date();
    const futuras = todas.filter((m) => new Date(m.scheduled_at) >= agora);
    const passadas = todas.filter((m) => new Date(m.scheduled_at) < agora).reverse();
    const cartao = (m, passada) => `
      <div class="reuniao-item ${passada ? "passada" : ""}">
        <div class="reuniao-data">
          <b>${new Date(m.scheduled_at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</b>
          <span>${new Date(m.scheduled_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <div style="min-width:0">
          <div class="reuniao-titulo">${escaparHtml(m.title)}</div>
          ${m.location ? `<div class="sub" style="font-size:12px">📍 ${escaparHtml(m.location)}</div>` : ""}
          ${m.description ? `<div class="sub" style="font-size:12px">${escaparHtml(m.description)}</div>` : ""}
          <div class="sub" style="font-size:11px;margin-top:2px">Marcada por ${escaparHtml(m.criado_por_nome || "—")}</div>
        </div>
      </div>`;
    lista.innerHTML =
      `<h4 class="perfil-sub" style="margin-top:0">Próximas</h4>` + (futuras.map((m) => cartao(m, false)).join("") || `<div class="sub">Sem reuniões marcadas.</div>`) +
      (passadas.length ? `<h4 class="perfil-sub">Anteriores</h4>` + passadas.slice(0, 10).map((m) => cartao(m, true)).join("") : "");
  } catch (err) {
    lista.innerHTML = `<div class="sub">${escaparHtml(err.message)}</div>`;
  }
}
function fecharReunioesProjeto() { document.getElementById("overlay-reunioes").classList.remove("open"); }

// ---------------- Vista "Equipa" (todos os membros do projeto) ----------------
let idsOnline = new Set();
function renderizarEquipa() {
  const grelha = document.getElementById("equipa-grelha");
  if (!grelha) return;
  const termo = norm(document.getElementById("equipa-busca").value.trim());
  const lista = estado.membros.filter((m) => !termo || norm(m.name + " " + m.email).includes(termo));
  const rotuloPapel = (m) => m.role === "responsavel" ? (m.id === eu.id ? "👑 Responsável (você)" : "👑 Responsável") : (m.id === eu.id ? "Membro (você)" : "Membro");
  document.getElementById("equipa-contagem").textContent = `${lista.length} de ${estado.membros.length} ${estado.membros.length === 1 ? "membro" : "membros"} · ${estado.membros.filter((m) => idsOnline.has(m.id)).length} online`;
  grelha.innerHTML = lista.map((m) => {
    const online = idsOnline.has(m.id);
    return `
    <div class="equipa-cartao" role="button" tabindex="0" onclick="abrirPerfilMembro('${m.id}')">
      <div class="avatar equipa-avatar" style="background:${m.avatar_color || corPara(m.id)}">${iniciais(m.name)}<i class="equipa-ponto ${online ? "on" : ""}"></i></div>
      <div style="min-width:0;flex:1">
        <div class="equipa-nome">${escaparHtml(m.name)}</div>
        <div class="equipa-papel">${rotuloPapel(m)}</div>
        <div class="equipa-email">${escaparHtml(m.email || "")}</div>
        <div class="equipa-estado ${online ? "on" : ""}">${online ? "Online agora" : (m.last_seen_at ? "Visto " + tempoRelativo(m.last_seen_at).toLowerCase() : "Ainda sem registo")}</div>
      </div>
    </div>`;
  }).join("") || `<div class="sub">Nenhum membro corresponde à pesquisa.</div>`;
}

// ---------------- Perfil do membro ----------------
function tempoRelativo(iso) {
  if (!iso) return "Ainda sem registo";
  const d = new Date(iso), seg = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (seg < 60) return "Há instantes";
  if (seg < 3600) return `Há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `Há ${Math.floor(seg / 3600)} h`;
  return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" }) + " às " + d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
}

async function abrirPerfilMembro(userId) {
  const membro = estado.membros.find((m) => m.id === userId);
  if (!membro) return;
  document.getElementById("pm-avatar").style.background = corPara(userId);
  document.getElementById("pm-avatar").textContent = iniciais(membro.name);
  document.getElementById("pm-nome").textContent = membro.name;
  document.getElementById("pm-papel").textContent = membro.role === "responsavel" ? "👑 Responsável do projeto" : "Membro da equipa";
  document.getElementById("pm-email").textContent = membro.email || "—";
  document.getElementById("pm-nivel").textContent = membro.role === "responsavel" ? "Responsável" : "Membro";
  ["pm-estado", "pm-visto"].forEach((i) => (document.getElementById(i).textContent = "A carregar…"));
  document.getElementById("pm-tarefas").innerHTML = `<div class="sub">A carregar…</div>`;
  document.getElementById("pm-tarefas-n").textContent = "";
  document.getElementById("pm-acoes").innerHTML = "";
  document.getElementById("overlay-membro").classList.add("open");

  try {
    const p = await api.get(`/api/projects/${projectId}/membros/${userId}/perfil`);
    document.getElementById("pm-email").textContent = p.email;
    const ehAdmin = p.nivel_plataforma === "admin";
    const nivel = ehAdmin ? (p.role === "responsavel" ? "Administrador · Responsável" : "Administrador") : (p.role === "responsavel" ? "Responsável" : "Membro");
    document.getElementById("pm-nivel").textContent = nivel;
    document.getElementById("pm-papel").textContent = (ehAdmin ? "🛡️ " : p.role === "responsavel" ? "👑 " : "") + nivel;
    document.getElementById("pm-estado").innerHTML = p.online
      ? `<span class="estado-online"><i></i>Online agora</span>`
      : `<span class="estado-offline"><i></i>Offline</span>`;
    document.getElementById("pm-visto").textContent = p.online ? "Agora mesmo" : tempoRelativo(p.last_seen_at);
    document.getElementById("pm-tarefas-n").textContent = `(${p.tarefas.length})`;
    const prio = { alta: "🔴", media: "🟡", baixa: "🟢" };
    document.getElementById("pm-tarefas").innerHTML = p.tarefas.map((t) => `
      <div class="perfil-tarefa ${t.is_done ? "feita" : ""}" onclick="fecharPerfilMembro();abrirModalDetalhe('${t.id}')">
        <span>${prio[t.priority] || ""}</span>
        <span class="pt-titulo">${escaparHtml(t.title)}</span>
        <span class="pt-col">${escaparHtml(t.coluna)}</span>
        ${t.due_date ? `<span class="pt-data">${new Date(t.due_date).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" })}</span>` : ""}
      </div>`).join("") || `<div class="sub">Sem tarefas atribuídas neste projeto.</div>`;

    const acoes = document.getElementById("pm-acoes");
    if (userId === eu.id) {
      acoes.innerHTML = `<button type="button" class="btn btn-perigo" onclick="fecharPerfilMembro();sairDoProjeto()"><i class="bi bi-box-arrow-right"></i> Sair do projeto</button>`;
    } else if (souDonoDoProjeto()) {
      const ehResp = p.role === "responsavel";
      acoes.innerHTML =
        `<button type="button" class="btn ${ehResp ? "btn-ghost" : "btn-primary"}" onclick="atribuirResponsavelDoPerfil('${userId}', ${!ehResp})"><i class="bi ${ehResp ? "bi-star" : "bi-star-fill"}"></i> ${ehResp ? "Retirar como responsável" : "Tornar responsável"}</button>` +
        `<button type="button" class="btn btn-perigo" onclick="removerMembroDoProjeto('${userId}')"><i class="bi bi-person-x"></i> Remover do projeto</button>`;
    }
  } catch (err) {
    document.getElementById("pm-estado").textContent = "Indisponível";
    document.getElementById("pm-visto").textContent = "Indisponível";
    document.getElementById("pm-tarefas").innerHTML = `<div class="sub">Não foi possível carregar os detalhes. Reinicie o servidor (npm start) para aplicar a última versão e tente novamente.</div>`;
    console.error("Perfil do membro:", err);
  }
}
async function atribuirResponsavelDoPerfil(userId, tornar) {
  const m = estado.membros.find((x) => x.id === userId);
  if (!m) return;
  const pergunta = tornar
    ? `Tornar ${m.name} responsável deste projeto? Passa a poder criar tarefas, gerir o quadro e aceder ao Espaço de gestão.`
    : `Retirar ${m.name} de responsável? Volta a ser membro e perde o acesso ao Espaço de gestão (se não for responsável de outro projeto).`;
  if (!(await gpiConfirm(pergunta))) return;
  await alternarResponsavel(userId, tornar);
  if (document.getElementById("overlay-membro").classList.contains("open")) abrirPerfilMembro(userId);
}
function fecharPerfilMembro() { document.getElementById("overlay-membro").classList.remove("open"); }

async function removerMembroDoProjeto(userId) {
  const m = estado.membros.find((x) => x.id === userId);
  if (!m) return;
  if (!(await gpiConfirm(`Remover ${m.name} do projeto "${estado.projeto?.name || ""}"? Deixará de ter acesso a ele.`))) return;
  try {
    await api.del(`/api/projects/${projectId}/membros/${userId}`);
    estado.membros = estado.membros.filter((x) => x.id !== userId);
    renderizarMembros();
    fecharPerfilMembro();
    mostrarToast(`${m.name} foi removido(a) do projeto.`);
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Seletor rápido de projeto ----------------
// Permite trocar de projeto sem ter de voltar a "Os meus projetos".
function renderizarSeletorProjetos() {
  const lista = document.getElementById("ps-lista");
  if (!lista) return;
  lista.innerHTML = projetosDoUtilizador.map((p) => `
    <div class="ps-item ${p.id === projectId ? "ativo" : ""}" data-ps-projeto="${p.id}">
      <span class="ps-nome">${p.name}${p.id === projectId ? " ✓" : ""}</span>
    </div>
  `).join("") || `<div class="ps-item" style="cursor:default">Sem outros projetos.</div>`;
  lista.innerHTML += `<div class="ps-footer" id="ps-ver-todos">Ver todos os projetos →</div>`;

  lista.querySelectorAll("[data-ps-projeto]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.psProjeto;
      if (id !== projectId) window.location.href = `/board.html?projeto=${id}`;
      else alternarSeletorProjetos(false);
    });
  });
  document.getElementById("ps-ver-todos")?.addEventListener("click", () => {
    window.location.href = "/projetos.html";
  });
}

function alternarSeletorProjetos(forcar) {
  const container = document.getElementById("project-switcher");
  const lista = document.getElementById("ps-lista");
  const abrir = forcar !== undefined ? forcar : lista.style.display === "none";
  lista.style.display = abrir ? "block" : "none";
  container.classList.toggle("aberto", abrir);
}
document.addEventListener("click", (e) => {
  const container = document.getElementById("project-switcher");
  if (container && !container.contains(e.target)) alternarSeletorProjetos(false);
});

// ---------------- Exportar o quadro (PDF / Excel) ----------------
function alternarMenuExportar(forcar) {
  const lista = document.getElementById("exportar-lista");
  const abrir = forcar !== undefined ? forcar : lista.style.display === "none";
  lista.style.display = abrir ? "block" : "none";
}
document.addEventListener("click", (e) => {
  const container = document.getElementById("exportar-switcher");
  if (container && !container.contains(e.target)) alternarMenuExportar(false);
});

// O ficheiro tem de levar o token de sessão (um link direto do navegador não
// envia o cabeçalho Authorization), por isso abre-se como um link com
// ?token=… em vez de um pedido feito pelo api.js.
function exportarQuadro(formato) {
  alternarMenuExportar(false);
  const url = `/api/projects/${projectId}/exportar/${formato === "excel" ? "excel" : "pdf"}?token=${encodeURIComponent(sessao.obterToken())}`;
  window.open(url, "_blank");
}

// Sair deste projeto (não é logout — só deixa de ser membro deste projeto em
// concreto). Se for o único responsável, o servidor recusa e pede para
// tornar outra pessoa responsável primeiro (ver "Responsável" acima).
async function sairDoProjeto() {
  if (!(await gpiConfirm(`Sair do projeto "${estado.projeto?.name || ""}"? Deixará de ter acesso a ele.`))) return;
  try {
    await api.del(`/api/projects/${projectId}/membros/${eu.id}`);
    mostrarToast("Saiu do projeto.");
    window.location.href = "/projetos.html";
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function alternarResponsavel(userId, tornarResponsavel) {
  try {
    await api.patch(`/api/projects/${projectId}/membros/${userId}/responsavel`, { responsavel: tornarResponsavel });
    const membro = estado.membros.find((m) => m.id === userId);
    if (membro) membro.role = tornarResponsavel ? "responsavel" : "membro";
    if (userId === eu.id) estado.sou_responsavel = tornarResponsavel || eu.role === "admin";
    renderizarMembros();
    renderizarQuadro();
  } catch (err) {
    mostrarToast(err.message);
    renderizarMembros(); // repõe o estado do checkbox
  }
}

async function carregarEtiquetas() {
  etiquetasProjeto = await api.get(`/api/projects/${projectId}/etiquetas`);
  renderizarSeletorEtiquetasFiltro();
}

function renderizarSeletorEtiquetasFiltro() {
  const sel = document.getElementById("filtro-etiqueta");
  sel.innerHTML = '<option value="">Todas as etiquetas</option>' +
    etiquetasProjeto.map((l) => `<option value="${l.id}">${l.name}</option>`).join("");
}

function passaNosFiltros(t) {
  // Subtarefas (Asana) não aparecem como cartões próprios no quadro — só
  // dentro do detalhe da tarefa-mãe, para não duplicar e poluir as colunas.
  if (t.parent_task_id) return false;
  if (filtroTexto && !t.title.toLowerCase().includes(filtroTexto.toLowerCase())) return false;
  if (filtroResponsavel && t.assignee_id !== filtroResponsavel) return false;
  if (filtroEtiqueta && !(t.labels || []).some((l) => l.id === filtroEtiqueta)) return false;
  return true;
}

function atualizarResumoQuadro() {
  const el = document.getElementById("rq-total");
  if (!el) return;
  const idsConcluidas = new Set(estado.colunas.filter((c) => c.is_done).map((c) => c.id));
  const principais = estado.tarefas.filter((t) => !t.parent_task_id);
  const feitas = principais.filter((t) => idsConcluidas.has(t.column_id)).length;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const atrasadas = principais.filter((t) => t.due_date && !idsConcluidas.has(t.column_id) && new Date(String(t.due_date).substring(0, 10) + "T00:00:00") < hoje).length;
  const pct = principais.length ? Math.round((feitas / principais.length) * 100) : 0;
  el.textContent = principais.length;
  document.getElementById("rq-feitas").textContent = feitas;
  document.getElementById("rq-atraso").textContent = atrasadas;
  document.getElementById("rq-membros").textContent = (estado.membros || []).length;
  document.getElementById("rq-pct").textContent = pct + "%";
  document.getElementById("rq-barra").style.width = pct + "%";
}

function renderizarQuadro() {
  atualizarResumoQuadro();
  const container = document.getElementById("board-columns");
  container.innerHTML = "";

  const modo = document.getElementById("agrupar-por")?.value || "coluna";
  if (modo !== "coluna") return renderizarQuadroAgrupado(modo, container);

  estado.colunas.forEach((col) => {
    const tarefasCol = estado.tarefas
      .filter((t) => t.column_id === col.id && passaNosFiltros(t))
      .sort((a, b) => a.position - b.position);

    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.dataset.colId = col.id;

    const menuGestao = souDonoDoProjeto() ? `
      <span style="cursor:pointer;color:var(--ink-faint);font-size:12px" title="Editar coluna" onclick="renomearColuna('${col.id}')">✏️</span>
      <span style="cursor:pointer;color:var(--ink-faint);font-size:12px;margin-left:6px" title="Eliminar coluna" onclick="eliminarColuna('${col.id}')">🗑️</span>
    ` : "";

    colEl.innerHTML = `
      <div class="column-head">
        <h4>${col.name}${col.is_done ? ' <span title="Coluna de tarefas concluídas" style="color:var(--success)">✓</span>' : ""}${col.restricted ? ' <span title="Restrita a responsáveis e administradores" style="color:var(--warn)">🔒</span>' : ""}${col.timer_start ? ' <span title="Inicia o registo de tempo das tarefas que entram aqui" style="color:var(--cyan)">⏱️</span>' : ""}</h4>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="column-count">${tarefasCol.length}</span>
          ${menuGestao}
        </div>
      </div>
      <div class="cards-zone" data-col-id="${col.id}"></div>
      ${souDonoDoProjeto() ? `<button class="add-task-btn" onclick="abrirModalTarefa('${col.id}')">+ Adicionar tarefa</button>` : ""}
    `;
    container.appendChild(colEl);

    const zona = colEl.querySelector(".cards-zone");
    tarefasCol.forEach((t) => zona.appendChild(criarCartao(t, col.id)));

    // A coluna inteira é a zona de largar (não só a faixa de cartões) — assim
    // uma coluna vazia continua a aceitar tarefas arrastadas, mesmo sem altura própria.
    colEl.addEventListener("dragover", (e) => { e.preventDefault(); colEl.classList.add("drag-over"); });
    colEl.addEventListener("dragleave", (e) => {
      if (!colEl.contains(e.relatedTarget)) colEl.classList.remove("drag-over");
    });
    colEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      colEl.classList.remove("drag-over");
      const taskId = e.dataTransfer.getData("text/task-id");
      if (!taskId) return;
      const novaPos = zona.children.length;
      try {
        await api.patch(`/api/tasks/${taskId}/mover`, { column_id: col.id, position: novaPos });
        if (col.is_done) celebrarConclusao();
      } catch (err) {
        mostrarToast(err.message);
      }
    });
  });

  if (souDonoDoProjeto()) {
    const novaColEl = document.createElement("div");
    novaColEl.className = "column";
    novaColEl.style.cssText = "display:flex;align-items:center;justify-content:center;cursor:pointer;border-style:dashed;color:var(--ink-faint);min-height:80px";
    novaColEl.innerHTML = `<div style="text-align:center">+<br/><span style="font-size:12px">Nova coluna</span></div>`;
    novaColEl.addEventListener("click", criarColuna);
    container.appendChild(novaColEl);
  }
}

// Agrupar o quadro por responsável/prioridade/etiqueta em vez de coluna
// (Monday.com/Smartsheet) — vista só de leitura quanto ao arrastar, porque
// o agrupamento aqui não corresponde a uma coluna real do quadro.
function renderizarQuadroAgrupado(modo, container) {
  const PRIORIDADES = { alta: "Alta prioridade", media: "Média prioridade", baixa: "Baixa prioridade" };
  const grupos = new Map();
  const tarefasVisiveis = estado.tarefas.filter(passaNosFiltros);

  const adicionarA = (chave, rotulo, tarefa) => {
    if (!grupos.has(chave)) grupos.set(chave, { rotulo, tarefas: [] });
    grupos.get(chave).tarefas.push(tarefa);
  };

  tarefasVisiveis.forEach((t) => {
    if (modo === "responsavel") {
      adicionarA(t.assignee_id || "—", t.assignee_name || "Sem responsável", t);
    } else if (modo === "prioridade") {
      adicionarA(t.priority, PRIORIDADES[t.priority] || t.priority, t);
    } else if (modo === "etiqueta") {
      if (!t.labels || t.labels.length === 0) adicionarA("—", "Sem etiqueta", t);
      else t.labels.forEach((l) => adicionarA(l.id, l.name, t));
    }
  });

  [...grupos.entries()].sort((a, b) => a[1].rotulo.localeCompare(b[1].rotulo)).forEach(([, grupo]) => {
    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.innerHTML = `
      <div class="column-head">
        <h4>${grupo.rotulo}</h4>
        <span class="column-count">${grupo.tarefas.length}</span>
      </div>
      <div class="cards-zone"></div>
    `;
    container.appendChild(colEl);
    const zona = colEl.querySelector(".cards-zone");
    grupo.tarefas.sort((a, b) => a.position - b.position).forEach((t) => zona.appendChild(criarCartao(t, t.column_id)));
  });

  if (grupos.size === 0) {
    container.innerHTML = `<p class="sub">Sem tarefas para mostrar.</p>`;
  }
}

function estaAtrasada(t, colunaId) {
  const coluna = estado.colunas.find((c) => c.id === colunaId);
  if (!t.due_date || coluna?.is_done) return false;
  return new Date(t.due_date) < new Date(new Date().toDateString());
}

function criarCartao(t, colunaId) {
  const el = document.createElement("div");
  el.className = `task-card card-prio-${t.priority}`;
  const podeMover = souDonoDoProjeto();
  el.draggable = podeMover;
  if (!podeMover) el.style.cursor = "pointer";
  el.dataset.taskId = t.id;
  const atrasada = estaAtrasada(t, colunaId);
  const progresso = t.checklist_total > 0 ? `<span style="font-size:11px;color:var(--ink-faint)">☑ ${t.checklist_feitos}/${t.checklist_total}</span>` : "";
  const subtarefas = t.subtarefas_total > 0 ? `<span style="font-size:11px;color:var(--ink-faint)" title="Subtarefas">↳ ${t.subtarefas_total}</span>` : "";
  const chips = (t.labels || []).map((l) => `<span style="background:${l.color}22;color:${l.color};border:1px solid ${l.color}55;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px">${l.name}</span>`).join(" ");

  el.innerHTML = `
    <span class="prio prio-${t.priority}">${t.priority}</span>
    ${chips ? `<div style="margin-bottom:8px;display:flex;gap:5px;flex-wrap:wrap">${chips}</div>` : ""}
    <div class="title">${t.title}</div>
    <div class="foot">
      <span class="due" style="${atrasada ? "color:var(--danger);font-weight:700" : ""}">${t.due_date ? (atrasada ? "⚠ " : "") + formatarData(t.due_date) : ""}</span>
      <div style="display:flex;align-items:center;gap:6px">
        ${subtarefas}
        ${progresso}
        ${t.assignee_name ? `<div class="avatar" style="width:22px;height:22px;font-size:10px;background:${corPara(t.assignee_id)}">${iniciais(t.assignee_name)}</div>` : ""}
      </div>
    </div>
  `;
  el.addEventListener("click", () => abrirModalDetalhe(t.id));
  el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/task-id", t.id); el.classList.add("dragging"); });
  el.addEventListener("dragend", () => el.classList.remove("dragging"));
  return el;
}

// ---------------- Gestão de colunas ----------------
const SUGESTOES_NOME_COLUNA = ["Por Fazer", "Em Curso", "Em Teste", "Em Revisão", "Bloqueado", "Backlog", "Concluído"];
let colunaEmEdicao = null; // null = a criar uma nova; caso contrário, o id da coluna a editar

function abrirModalColuna(coluna = null) {
  colunaEmEdicao = coluna ? coluna.id : null;
  document.getElementById("titulo-modal-coluna").textContent = coluna ? "Editar coluna" : "Nova coluna";
  document.getElementById("btn-guardar-coluna").textContent = coluna ? "Guardar alterações" : "Criar coluna";
  document.getElementById("coluna-nome").value = coluna ? coluna.name : "";
  document.getElementById("coluna-is-done").checked = coluna ? !!coluna.is_done : false;
  document.getElementById("coluna-restricted").checked = coluna ? !!coluna.restricted : false;
  document.getElementById("coluna-timer").checked = coluna ? !!coluna.timer_start : false;
  sincronizarOpcaoTimerColuna();
  document.getElementById("erro-coluna").style.display = "none";

  document.getElementById("sugestoes-nome-coluna").innerHTML = SUGESTOES_NOME_COLUNA.map((s) => `
    <button type="button" class="chip-sugestao" onclick="document.getElementById('coluna-nome').value='${s}'">${s}</button>
  `).join("");

  document.getElementById("overlay-coluna").classList.add("open");
}
// Colunas concluídas ou protegidas nunca contam tempo: a opção fica desligada e bloqueada
function sincronizarOpcaoTimerColuna() {
  const bloqueada = document.getElementById("coluna-is-done").checked || document.getElementById("coluna-restricted").checked;
  const cb = document.getElementById("coluna-timer");
  if (bloqueada) cb.checked = false;
  cb.disabled = bloqueada;
  document.getElementById("campo-coluna-timer").style.opacity = bloqueada ? ".5" : "1";
  document.getElementById("coluna-timer-nota").textContent = bloqueada
    ? "Indisponível: o registo de tempo não conta em colunas concluídas nem protegidas."
    : "Conta para o responsável da tarefa. Nunca conta em colunas concluídas ou protegidas.";
}
function fecharModalColuna() {
  document.getElementById("overlay-coluna").classList.remove("open");
  colunaEmEdicao = null;
}
function criarColuna() { abrirModalColuna(); }
function renomearColuna(colId) {
  const coluna = estado.colunas.find((c) => c.id === colId);
  if (coluna) abrirModalColuna(coluna);
}
async function eliminarColuna(colId) {
  if (!(await gpiConfirm("Eliminar esta coluna? Só é possível se estiver vazia."))) return;
  try {
    await api.del(`/api/projects/colunas/${colId}`);
    estado.colunas = estado.colunas.filter((c) => c.id !== colId);
    renderizarQuadro();
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Gestão do projeto (editar / eliminar) ----------------
function ligarControlosProjeto() {
  document.getElementById("btn-editar-projeto").addEventListener("click", () => {
    document.getElementById("ep-nome").value = document.getElementById("nome-projeto").textContent;
    document.getElementById("ep-desc").value = document.getElementById("desc-projeto").textContent;
    document.getElementById("overlay-editar-projeto").classList.add("open");
  });
  document.getElementById("btn-eliminar-projeto").addEventListener("click", async () => {
    const nomeProjeto = document.getElementById("nome-projeto").textContent;
    if (!(await gpiConfirm(`Eliminar definitivamente o projeto "${nomeProjeto}"? Todas as tarefas, comentários e etiquetas serão perdidos. Esta ação não pode ser revertida.`))) return;
    try {
      await api.del(`/api/projects/${projectId}`);
      window.location.href = "/projetos.html";
    } catch (err) {
      mostrarToast(err.message);
    }
  });
  document.getElementById("form-editar-projeto").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/api/projects/${projectId}`, {
        name: document.getElementById("ep-nome").value,
        description: document.getElementById("ep-desc").value,
      });
      document.getElementById("overlay-editar-projeto").classList.remove("open");
    } catch (err) {
      mostrarToast(err.message);
    }
  });
}
function fecharModalEditarProjeto() {
  document.getElementById("overlay-editar-projeto").classList.remove("open");
}

// ---------------- Socket.IO — tempo real ----------------
function conectarSocket() {
  socket = io({ auth: { token: sessao.obterToken() } });

  socket.on("connect", () => socket.emit("project:entrar", projectId));

  socket.on("connect_error", (err) => {
    console.error("Erro de ligação em tempo real (Socket.IO):", err.message);
    mostrarToast("Falha na ligação em tempo real: " + err.message);
  });

  iniciarNotificacoes(socket);

  socket.on("presence:update", (utilizadores) => {
    idsOnline = new Set(utilizadores.map((u) => u.id));
    if (estado && estado.membros) renderizarMembros();
    if (document.getElementById("view-equipa")?.style.display !== "none") renderizarEquipa();
    const wrap = document.getElementById("presenca");
    wrap.innerHTML = utilizadores
      .map((u) => `<div class="avatar" style="background:${corPara(u.id)}" title="${u.name}">${iniciais(u.name)}</div>`)
      .join("") + `<span class="presence-label">${utilizadores.length} online agora</span>`;
  });

  socket.on("task:created", ({ task, autor, autorId }) => {
    if (autorId ? autorId === eu.id : autor === eu.name) return;
    const coluna = estado.colunas.find((c) => c.id === task.column_id);
    if (!coluna) return; // coluna restrita que este utilizador nem sequer vê
    estado.tarefas.push(task);
    renderizarQuadro();
    mostrarToast(`${autor} criou a tarefa "${task.title}"`);
  });

  socket.on("task:updated", ({ task }) => {
    const idx = estado.tarefas.findIndex((t) => t.id === task.id);
    if (idx > -1) estado.tarefas[idx] = { ...estado.tarefas[idx], ...task };
    renderizarQuadro();
    if (tarefaAtiva && tarefaAtiva.id === task.id) Object.assign(tarefaAtiva, task);
  });

  socket.on("task:moved", ({ task, autor }) => {
    const colunaVisivel = estado.colunas.find((c) => c.id === task.column_id);
    const idx = estado.tarefas.findIndex((t) => t.id === task.id);
    if (!colunaVisivel) {
      // Foi movida para uma coluna restrita que este utilizador não vê — remove-a do seu quadro
      if (idx > -1) estado.tarefas.splice(idx, 1);
      renderizarQuadro();
      return;
    }
    if (idx > -1) estado.tarefas[idx] = { ...estado.tarefas[idx], ...task };
    else estado.tarefas.push(task); // entrou vinda de uma coluna restrita para uma visível
    renderizarQuadro();
    if (autor !== eu.name) mostrarToast(`${autor} moveu "${task.title}"`);
  });

  socket.on("task:deleted", ({ taskId, autor }) => {
    estado.tarefas = estado.tarefas.filter((t) => t.id !== taskId);
    renderizarQuadro();
    if (tarefaAtiva && tarefaAtiva.id === taskId) {
      fecharModalDetalhe();
      mostrarToast(`${autor} eliminou essa tarefa.`);
    }
  });

  socket.on("task:labels", ({ taskId, labels }) => {
    const idx = estado.tarefas.findIndex((t) => t.id === taskId);
    if (idx > -1) estado.tarefas[idx].labels = labels;
    renderizarQuadro();
    if (tarefaAtiva && tarefaAtiva.id === taskId) { tarefaAtiva.labels = labels; renderizarEtiquetasDetalhe(); }
  });

  socket.on("label:created", (label) => {
    etiquetasProjeto.push(label);
    renderizarSeletorEtiquetasFiltro();
  });

  socket.on("label:deleted", ({ labelId }) => {
    etiquetasProjeto = etiquetasProjeto.filter((l) => l.id !== labelId);
    renderizarSeletorEtiquetasFiltro();
    estado.tarefas.forEach((t) => { t.labels = (t.labels || []).filter((l) => l.id !== labelId); });
    renderizarQuadro();
    if (tarefaAtiva) renderizarEtiquetasDetalhe();
  });

  socket.on("member:added", ({ membro }) => {
    if (!estado.membros.some((m) => m.id === membro.id)) {
      estado.membros.push(membro);
      renderizarMembros();
      document.getElementById("nt-responsavel").innerHTML += `<option value="${membro.id}">${membro.name}</option>`;
      document.getElementById("filtro-responsavel").innerHTML += `<option value="${membro.id}">${membro.name}</option>`;
      const etResp = document.getElementById("et-responsavel");
      if (etResp) etResp.innerHTML += `<option value="${membro.id}">${membro.name}</option>`;
      mostrarToast(`${membro.name} foi adicionado(a) ao projeto`);
    }
  });

  socket.on("member:removed", ({ userId }) => {
    estado.membros = estado.membros.filter((m) => m.id !== userId);
    renderizarMembros();
    if (userId === eu.id) {
      mostrarToast("Foi removido(a) deste projeto.");
      setTimeout(() => (window.location.href = "/projetos.html"), 1500);
    }
  });

  socket.on("member:role-updated", ({ userId, role }) => {
    const membro = estado.membros.find((m) => m.id === userId);
    if (membro) membro.role = role;
    if (userId === eu.id) {
      estado.sou_responsavel = role === "responsavel" || eu.role === "admin";
      mostrarToast(role === "responsavel" ? "Foi tornado(a) responsável deste projeto." : "Deixou de ser responsável deste projeto.");
    }
    renderizarMembros();
    renderizarQuadro();
  });

  socket.on("comment:created", ({ comment }) => {
    if (tarefaAtiva && comment.task_id === tarefaAtiva.id) adicionarComentarioNaLista(comment);
    if (comment.user_id !== eu.id) mostrarToast(`${comment.user_name} comentou numa tarefa`);
  });

  socket.on("comment:deleted", ({ commentId, taskId }) => {
    if (tarefaAtiva && taskId === tarefaAtiva.id) {
      document.querySelector(`.comment-item[data-comment-id="${commentId}"]`)?.remove();
    }
  });

  socket.on("comment:digitando", ({ taskId, user }) => {
    if (tarefaAtiva && taskId === tarefaAtiva.id) {
      const ind = document.getElementById("indicador-digitando");
      ind.textContent = `${user} está a escrever…`;
      clearTimeout(timeoutDigitando);
      timeoutDigitando = setTimeout(() => (ind.textContent = ""), 2000);
    }
  });

  socket.on("checklist:item-created", ({ taskId, item, autorId }) => {
    // Quem acrescentou o item já o viu localmente ao submeter o formulário —
    // evita mostrá-lo em duplicado quando o eco do servidor chega de volta.
    if (autorId && autorId === eu.id) return;
    atualizarChecklistLocal(taskId, (lista) => [...lista, item]);
  });
  socket.on("checklist:item-updated", ({ taskId, item }) => atualizarChecklistLocal(taskId, (lista) => lista.map((i) => (i.id === item.id ? item : i))));
  socket.on("checklist:item-deleted", ({ taskId, itemId }) => atualizarChecklistLocal(taskId, (lista) => lista.filter((i) => i.id !== itemId)));

  socket.on("attachment:created", ({ taskId, anexo }) => {
    if (tarefaAtiva && tarefaAtiva.id === taskId && !anexosAtivos.some((a) => a.id === anexo.id)) {
      anexosAtivos.unshift(anexo);
      renderizarAnexos();
    }
  });

  socket.on("channel:message", (m) => {
    // Mensagem de outra conversa (outro grupo, ou geral): só marca como não lida.
    if ((m.group_id || null) !== grupoAtivo) {
      gruposNaoLidos.add(m.group_id || "geral");
      renderizarGruposCanal();
      return;
    }
    mensagensCanalCache.push(m);
    // Uma mensagem nova só aparece de imediato se não houver pesquisa ativa
    // a escondê-la — caso contrário ficaria visível mesmo sem bater com o
    // termo procurado.
    if (!document.getElementById("channel-pesquisa")?.value.trim()) {
      const feed = document.getElementById("channel-feed");
      feed.insertAdjacentHTML("beforeend", criarBolhaCanal(m));
      feed.lastElementChild?.classList.add("nova");
      feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
    }
  });

  socket.on("channel:message-edited", ({ id, content }) => {
    const cache = mensagensCanalCache.find((m) => m.id === id);
    if (cache) { cache.content = content; cache.edited_at = new Date().toISOString(); }
    const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
    if (!el) return;
    el.dataset.content = content;
    const bubble = el.querySelector(".bubble");
    if (bubble) bubble.innerHTML = realcarMencoes(content);
    let tag = el.querySelector(".channel-edited-tag");
    const meta = el.querySelector(".meta");
    if (meta && !tag) {
      tag = document.createElement("span");
      tag.className = "channel-edited-tag";
      tag.textContent = "(editada)";
      meta.appendChild(tag);
    }
  });

  socket.on("channel:message-deleted", ({ id, escopo }) => {
    if (escopo !== "todos") return; // "para mim" só afeta quem pediu, via resposta direta do pedido
    const cache = mensagensCanalCache.find((m) => m.id === id);
    if (cache) { cache.deleted_at = new Date().toISOString(); cache.pinned_at = null; renderizarFixadas(); }
    mensagensSelecionadas.delete(id);
    atualizarBarraSelecao();
    const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
    if (!el) return;
    el.classList.add("eliminada");
    const bubble = el.querySelector(".bubble, .channel-media-img, .channel-audio-player, .channel-file-chip");
    if (bubble) bubble.outerHTML = `<div class="bubble">Mensagem eliminada</div>`;
    el.querySelector(".channel-msg-acoes")?.remove();
  });

  socket.on("channel:digitando", ({ user, grupoId }) => {
    if ((grupoId || null) !== grupoAtivo) return;
    if (document.getElementById("view-conversa").style.display === "none") return;
    const ind = document.getElementById("channel-digitando");
    ind.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span>${user} está a escrever…`;
    clearTimeout(timeoutDigitandoCanal);
    timeoutDigitandoCanal = setTimeout(() => (ind.innerHTML = ""), 2200);
  });

  socket.on("channel:pin", ({ id, pinned_at, pinned_by_nome }) => {
    const cache = mensagensCanalCache.find((m) => m.id === id);
    if (!cache) return;
    cache.pinned_at = pinned_at;
    cache.pinned_by_nome = pinned_by_nome;
    atualizarMarcaFixada(id);
    renderizarFixadas();
  });

  socket.on("channel:group-changed", async ({ removido }) => {
    if (!vistasCarregadas.has("conversa")) return;
    await carregarGruposCanal();
    if (removido && removido === grupoAtivo) {
      mostrarToast("Já não faz parte deste grupo.");
      await selecionarGrupo(null);
    } else if (grupoAtivo && !gruposCanal.some((g) => g.id === grupoAtivo)) {
      await selecionarGrupo(null);
    } else {
      renderizarGruposCanal();
    }
  });

  socket.on("channel:reaction", ({ messageId, reacoes }) => {
    const cache = mensagensCanalCache.find((m) => m.id === messageId);
    if (cache) cache.reacoes = reacoes;
    const box = document.getElementById(`reacoes-${messageId}`);
    if (box) box.innerHTML = construirChipsReacao(reacoes, messageId);
  });

  socket.on("column:created", (coluna) => {
    if (coluna.restricted && !souDonoDoProjeto()) return;
    if (coluna.is_done) estado.colunas.forEach((c) => (c.is_done = false));
    if (!estado.colunas.some((c) => c.id === coluna.id)) estado.colunas.push(coluna); // quem a criou já a tem
    renderizarQuadro();
  });
  socket.on("column:updated", (coluna) => {
    const idx = estado.colunas.findIndex((c) => c.id === coluna.id);
    if (coluna.restricted && !souDonoDoProjeto()) {
      // Tornou-se restrita agora — deixa de estar visível para este utilizador
      if (idx > -1) estado.colunas.splice(idx, 1);
      renderizarQuadro();
      return;
    }
    if (coluna.is_done) estado.colunas.forEach((c) => (c.is_done = c.id === coluna.id));
    if (idx > -1) estado.colunas[idx] = coluna;
    else estado.colunas.push(coluna); // deixou de ser restrita e passou a estar visível
    renderizarQuadro();
  });
  socket.on("column:deleted", ({ columnId }) => {
    estado.colunas = estado.colunas.filter((c) => c.id !== columnId);
    renderizarQuadro();
  });

  socket.on("project:updated", ({ projeto, autor }) => {
    estado.projeto = { ...estado.projeto, ...projeto };
    document.getElementById("nome-projeto").textContent = projeto.name;
    document.getElementById("desc-projeto").textContent = projeto.description || "";
    if (autor !== eu.name) mostrarToast(`${autor} atualizou os dados do projeto.`);
  });

  // Qualquer alteração ao projeto/tarefas feita por outra pessoa (sobretudo por
  // responsáveis e administradores): volta a pedir o quadro, que o servidor já
  // filtra pelas regras de visibilidade, e atualiza o que está no ecrã.
  socket.on("projeto:alterado", ({ autorId }) => {
    if (autorId && autorId === eu.id) return;
    agendarSincronizacao();
  });

  // Registo de tempo iniciado/parado automaticamente (coluna, automação ou coluna concluída)
  socket.on("tempo:iniciado", ({ taskId }) => { if (tarefaAtiva && tarefaAtiva.id === taskId) carregarCronometro(taskId); mostrarToast("⏱️ O registo de tempo começou a contar numa das suas tarefas."); });
  socket.on("tempo:parado", ({ taskId }) => { if (tarefaAtiva && tarefaAtiva.id === taskId) carregarCronometro(taskId); });

  socket.on("task:tempo-registado", ({ taskId }) => { if (tarefaAtiva && tarefaAtiva.id === taskId) carregarCronometro(taskId); });

  socket.on("project:deleted", ({ autor }) => {
    gpiAviso(`${autor} eliminou este projeto. Vai ser redirecionado(a) para a lista de projetos.`, "Projeto eliminado").then(() => (window.location.href = "/projetos.html"));
  });
}

// ---------------- Sincronização em tempo real ----------------
let temporizadorSync = null, aSincronizar = false, sincronizarDeNovo = false;
function agendarSincronizacao() {
  clearTimeout(temporizadorSync);
  temporizadorSync = setTimeout(sincronizarProjeto, 350);
}

async function sincronizarProjeto() {
  if (aSincronizar) { sincronizarDeNovo = true; return; }
  aSincronizar = true;
  try {
    const guardar = ["filtro-responsavel", "nt-responsavel", "et-responsavel"].map((id) => [id, document.getElementById(id)?.value]);
    const eraGestor = souDonoDoProjeto();
    const podiaEditar = tarefaAtiva ? podeGerirTarefa(tarefaAtiva) : false;

    await carregarQuadro(true);
    guardar.forEach(([id, v]) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; });
    carregarEtiquetas().catch(() => {});

    // Permissões mudaram (ex.: passou a responsável ou deixou de o ser)
    const btnEditar = document.getElementById("btn-editar-projeto"), btnElim = document.getElementById("btn-eliminar-projeto");
    const gestor = souDonoDoProjeto();
    if (btnEditar) btnEditar.style.display = gestor ? "inline" : "none";
    if (btnElim) btnElim.style.display = gestor ? "inline" : "none";
    document.getElementById("bloco-campos-personalizados").style.display = gestor ? "block" : "none";
    document.getElementById("bloco-espaco-gestao").style.display = gestor ? "block" : "none";
    carregarPedidosConvite();
    if (eraGestor !== gestor && document.getElementById("view-automacoes").style.display !== "none") carregarAutomacoes();

    // Vista que está aberta
    const vista = document.querySelector(".view-tab.active")?.dataset.view;
    if (vista === "lista") renderizarListaTarefas();
    else if (vista === "calendario") renderizarCalendario();
    else if (vista === "gantt") renderizarGantt();
    else if (vista === "metas") await carregarMetas();
    else if (vista === "equipa") renderizarEquipa();
    else if (vista === "automacoes") await carregarAutomacoes();
    if (document.getElementById("overlay-dia")?.classList.contains("open")) renderizarListaModalDia?.();

    // Tarefa aberta no detalhe
    if (tarefaAtiva) {
      const atual = estado.tarefas.find((t) => t.id === tarefaAtiva.id);
      if (!atual) {
        fecharModalDetalhe();
        mostrarToast("Esta tarefa foi eliminada ou já não está visível para si.");
      } else {
        const id = atual.id;
        Object.assign(tarefaAtiva, atual);
        if (podeGerirTarefa(tarefaAtiva) !== podiaEditar) {
          await abrirModalDetalhe(id); // mudou entre só-leitura e editável
        } else {
          const podeInteragir = podeInteragirComTarefaAtiva();
          const aEscrever = document.activeElement && document.getElementById("det-campos-personalizados")?.contains(document.activeElement);
          await Promise.all([
            aEscrever ? null : carregarCamposPersonalizadosTarefa(id, podeInteragir),
            carregarDependencias(id, podeInteragir),
            carregarSubtarefas(id, podeInteragir),
            typeof carregarResponsaveisExtra === "function" ? carregarResponsaveisExtra(id).catch(() => {}) : null,
          ]);
          renderizarEtiquetasDetalhe();
        }
      }
    }
  } catch (err) {
    console.error("Erro ao sincronizar o projeto:", err);
  } finally {
    aSincronizar = false;
    if (sincronizarDeNovo) { sincronizarDeNovo = false; agendarSincronizacao(); }
  }
}

let checklistAtiva = [];
function atualizarChecklistLocal(taskId, fn) {
  if (!tarefaAtiva || tarefaAtiva.id !== taskId) return;
  checklistAtiva = fn(checklistAtiva);
  renderizarChecklist();
}

// ---------------- Filtros ----------------
function ligarFiltros() {
  document.getElementById("campo-pesquisa").addEventListener("input", (e) => { filtroTexto = e.target.value; renderizarQuadro(); });
  document.getElementById("filtro-responsavel").addEventListener("change", (e) => { filtroResponsavel = e.target.value; renderizarQuadro(); });
  document.getElementById("filtro-etiqueta").addEventListener("change", (e) => { filtroEtiqueta = e.target.value; renderizarQuadro(); });
  document.getElementById("agrupar-por").addEventListener("change", renderizarQuadro);
}

// ---------------- Vista Gantt (Monday.com / Smartsheet) ----------------
function renderizarGantt() {
  const container = document.getElementById("gantt-container");
  const tarefas = estado.tarefas.filter((t) => t.start_date && t.due_date && !t.parent_task_id);
  if (tarefas.length === 0) {
    container.innerHTML = `<p class="sub">Nenhuma tarefa tem data de início E prazo definidas ainda.</p>`;
    return;
  }
  const inicios = tarefas.map((t) => new Date(t.start_date).getTime());
  const fins = tarefas.map((t) => new Date(t.due_date).getTime());
  const minimo = Math.min(...inicios);
  const maximo = Math.max(...fins);
  const amplitude = Math.max(maximo - minimo, 86400000);

  const coresPrioridade = { alta: "var(--danger, #e05260)", media: "var(--warn, #e6a23c)", baixa: "var(--success, #2ecc71)" };
  container.innerHTML = tarefas
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
    .map((t) => {
      const ini = new Date(t.start_date).getTime();
      const fim = new Date(t.due_date).getTime();
      const esquerda = ((ini - minimo) / amplitude) * 100;
      const largura = Math.max(((fim - ini) / amplitude) * 100, 1.5);
      return `
        <div class="gantt-row">
          <div class="gantt-label" title="${t.title}">${t.title}</div>
          <div class="gantt-track">
            <div class="gantt-bar" style="left:${esquerda}%;width:${largura}%;background:${coresPrioridade[t.priority] || "var(--cyan)"}"
                 title="${t.title}: ${formatarDataPt(t.start_date)} → ${formatarDataPt(t.due_date)}"
                 onclick="abrirModalDetalhe('${t.id}')"></div>
          </div>
        </div>`;
    })
    .join("");
}

function formatarDataPt(iso) {
  return new Date(iso).toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
}

// ---------------- Modal: nova tarefa ----------------
function abrirModalTarefa(colId) {
  document.getElementById("nt-coluna").value = colId;
  // Projeto com um único membro: ele é, por omissão, o responsável da tarefa
  if (estado.membros.length === 1) document.getElementById("nt-responsavel").value = estado.membros[0].id;
  etiquetasSelecionadasNaTarefaNova = new Set();
  checklistNovaTarefa = [];
  renderizarChecklistNovaTarefa();
  document.getElementById("campo-nt-checklist").style.display = souDonoDoProjeto() ? "block" : "none";
  // Grupo de conversa da tarefa (só responsáveis do projeto/admin)
  document.getElementById("campo-nt-grupo").style.display = souDonoDoProjeto() ? "block" : "none";
  document.getElementById("nt-grupo-ativo").checked = false;
  document.getElementById("nt-grupo-opcoes").style.display = "none";
  document.getElementById("nt-grupo-nome").value = "";
  renderizarSeletorMembros("nt-grupo-membros", estado.membros, new Set([eu.id]), new Set([eu.id]));
  document.getElementById("nt-etiquetas").innerHTML = etiquetasProjeto.map((l) => `
    <span class="chip-toggle" data-id="${l.id}" style="cursor:pointer;user-select:none;background:transparent;color:${l.color};border:1px solid ${l.color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px">${l.name}</span>
  `).join("") || `<span style="font-size:12px;color:var(--ink-faint)">Sem etiquetas no projeto ainda.</span>`;

  document.querySelectorAll("#nt-etiquetas .chip-toggle").forEach((chip) => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.id;
      if (etiquetasSelecionadasNaTarefaNova.has(id)) {
        etiquetasSelecionadasNaTarefaNova.delete(id);
        chip.style.background = "transparent";
      } else {
        etiquetasSelecionadasNaTarefaNova.add(id);
        chip.style.background = chip.style.color + "22";
      }
    });
  });

  document.getElementById("overlay-tarefa").classList.add("open");
}
function fecharModalTarefa() {
  document.getElementById("overlay-tarefa").classList.remove("open");
  document.getElementById("form-nova-tarefa").reset();
  document.getElementById("nt-grupo-opcoes").style.display = "none";
  checklistNovaTarefa = [];
}

// ---------------- Checklist ao criar a tarefa (só responsáveis/admin) ----------------
let checklistNovaTarefa = [];
function renderizarChecklistNovaTarefa() {
  document.getElementById("nt-checklist-lista").innerHTML = checklistNovaTarefa.map((texto, i) => `
    <div style="display:flex;align-items:center;gap:8px;font-size:12.5px">
      <span style="flex:1">✓ ${texto}</span>
      <span style="cursor:pointer;color:var(--ink-faint)" onclick="removerItemChecklistNovaTarefa(${i})">✕</span>
    </div>
  `).join("");
}
function adicionarItemChecklistNovaTarefa() {
  const input = document.getElementById("nt-checklist-input");
  const texto = input.value.trim();
  if (!texto) return;
  checklistNovaTarefa.push(texto);
  input.value = "";
  renderizarChecklistNovaTarefa();
}
function removerItemChecklistNovaTarefa(i) {
  checklistNovaTarefa.splice(i, 1);
  renderizarChecklistNovaTarefa();
}

// ---------------- Modal: convidar membros (pesquisa + seleção múltipla) ----------------
let convDebounce = null;
const convSelecionados = new Map(); // id -> utilizador (a seleção sobrevive a novas pesquisas)
function abrirModalConvite() {
  document.getElementById("overlay-convite").classList.add("open");
  document.getElementById("conv-pesquisa").value = "";
  document.getElementById("conv-ordenar").value = "nome_asc";
  convSelecionados.clear();
  atualizarBarraConvite();
  pesquisarUtilizadoresParaConvidar();
  document.getElementById("conv-pesquisa").focus();
}
function fecharModalConvite() {
  document.getElementById("overlay-convite").classList.remove("open");
  document.getElementById("erro-convite").style.display = "none";
}

let resultadosConviteAtuais = [];
async function pesquisarUtilizadoresParaConvidar() {
  const search = document.getElementById("conv-pesquisa").value.trim();
  const sort = document.getElementById("conv-ordenar").value;
  const resultados = document.getElementById("conv-resultados");
  try {
    resultadosConviteAtuais = await api.get(`/api/projects/${projectId}/utilizadores-disponiveis?search=${encodeURIComponent(search)}&sort=${sort}`);
    resultados.innerHTML = resultadosConviteAtuais.map((u) => `
      <label class="conv-item ${convSelecionados.has(u.id) ? "sel" : ""}" data-id="${u.id}">
        <input type="checkbox" ${convSelecionados.has(u.id) ? "checked" : ""} />
        <div class="avatar" style="width:28px;height:28px;font-size:11px;background:${u.avatar_color || corPara(u.id)}">${iniciais(u.name)}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;overflow-wrap:anywhere">${escaparHtml(u.name)}</div>
          <div style="font-size:11px;color:var(--ink-faint);overflow-wrap:anywhere">${escaparHtml(u.email)}</div>
        </div>
      </label>
    `).join("") || `<div class="sub" style="text-align:center;padding:16px 0">Sem resultados.</div>`;
    resultados.querySelectorAll(".conv-item input").forEach((cb) => {
      cb.addEventListener("change", () => {
        const item = cb.closest(".conv-item");
        const u = resultadosConviteAtuais.find((x) => x.id === item.dataset.id);
        if (!u) return;
        if (cb.checked) convSelecionados.set(u.id, u); else convSelecionados.delete(u.id);
        item.classList.toggle("sel", cb.checked);
        atualizarBarraConvite();
      });
    });
    atualizarBarraConvite();
  } catch (err) {
    resultados.innerHTML = `<div class="sub" style="text-align:center;padding:16px 0">${escaparHtml(err.message)}</div>`;
  }
}

function atualizarBarraConvite() {
  const n = convSelecionados.size;
  document.getElementById("conv-contagem").textContent = n === 0 ? "Nenhum selecionado" : n === 1 ? "1 selecionado" : `${n} selecionados`;
  document.getElementById("conv-limpar").style.display = n ? "" : "none";
  const botao = document.getElementById("conv-enviar");
  botao.disabled = n === 0;
  const gestor = souDonoDoProjeto();
  botao.textContent = n === 0 ? "Convidar selecionados"
    : gestor ? `Convidar ${n} ${n === 1 ? "pessoa" : "pessoas"}` : `Propor convite a ${n} ${n === 1 ? "pessoa" : "pessoas"}`;
  const todos = document.getElementById("conv-todos");
  const visiveis = resultadosConviteAtuais.length;
  const marcadosVisiveis = resultadosConviteAtuais.filter((u) => convSelecionados.has(u.id)).length;
  todos.checked = visiveis > 0 && marcadosVisiveis === visiveis;
  todos.indeterminate = marcadosVisiveis > 0 && marcadosVisiveis < visiveis;
  todos.disabled = visiveis === 0;
}

async function convidarSelecionados() {
  const erroBox = document.getElementById("erro-convite");
  erroBox.style.display = "none";
  const alvos = [...convSelecionados.values()];
  if (alvos.length === 0) return;
  const botao = document.getElementById("conv-enviar");
  botao.disabled = true;
  botao.textContent = "A enviar…";

  let feitos = 0, aguardam = 0;
  const falhas = [];
  for (const alvo of alvos) {
    try {
      const resp = await api.post(`/api/projects/${projectId}/membros`, { email: alvo.email });
      feitos++;
      if (resp.status === "aguarda_aprovacao") aguardam++;
      convSelecionados.delete(alvo.id);
    } catch (err) {
      falhas.push(`${alvo.name}: ${err.message}`);
    }
  }

  if (falhas.length === 0) {
    mostrarToast(aguardam === feitos
      ? (feitos === 1 ? `Pedido enviado ao responsável do projeto para aprovar o convite a ${alvos[0].name}.` : `${feitos} pedidos enviados ao responsável do projeto para aprovação.`)
      : (feitos === 1 ? `Convite enviado a ${alvos[0].name}.` : `${feitos} convites enviados.`));
    fecharModalConvite();
  } else {
    // Mantém aberta só com quem falhou, para tentar de novo ou corrigir
    if (feitos) mostrarToast(`${feitos} ${feitos === 1 ? "convite enviado" : "convites enviados"}.`);
    erroBox.innerHTML = falhas.map(escaparHtml).join("<br/>");
    erroBox.style.display = "block";
    pesquisarUtilizadoresParaConvidar();
  }
  atualizarBarraConvite();
}

// ---------------- Modal: detalhe + edição + comentários + checklist ----------------
async function abrirModalDetalhe(taskId) {
  tarefaAtiva = estado.tarefas.find((t) => t.id === taskId);
  if (!tarefaAtiva) return;

  atualizarBotaoGrupoTarefa();
  const editavel = podeGerirTarefa(tarefaAtiva);
  document.getElementById("det-vista-leitura").style.display = editavel ? "none" : "block";
  document.getElementById("form-editar-tarefa").style.display = editavel ? "block" : "none";

  if (editavel) {
    document.getElementById("et-titulo").value = tarefaAtiva.title;
    document.getElementById("et-descricao").value = tarefaAtiva.description || "";
    document.getElementById("et-prioridade").value = tarefaAtiva.priority;
    document.getElementById("et-responsavel").value = tarefaAtiva.assignee_id || "";
    document.getElementById("et-prazo").value = tarefaAtiva.due_date ? tarefaAtiva.due_date.substring(0, 10) : "";
    document.getElementById("et-inicio").value = tarefaAtiva.start_date ? tarefaAtiva.start_date.substring(0, 10) : "";
    // Só responsáveis do projeto/administradores podem mudar quem vê a tarefa
    const campoVisibilidade = document.getElementById("campo-et-visibilidade");
    campoVisibilidade.style.display = souDonoDoProjeto() ? "block" : "none";
    document.getElementById("et-visibilidade").value = tarefaAtiva.visibility || "equipa";
  } else {
    document.getElementById("det-titulo").textContent = tarefaAtiva.title;
    document.getElementById("det-meta").textContent =
      `Prioridade: ${tarefaAtiva.priority} · Responsável: ${tarefaAtiva.assignee_name || "—"}${tarefaAtiva.due_date ? " · Prazo: " + formatarData(tarefaAtiva.due_date) : ""}`;
  }

  renderizarEtiquetasDetalhe();

  await carregarResponsaveisExtra(taskId);

  checklistAtiva = await api.get(`/api/tasks/${taskId}/checklist`);
  renderizarChecklist();
  const formChecklist = document.getElementById("form-checklist");
  if (formChecklist) formChecklist.style.display = souDonoDoProjeto() ? "flex" : "none";

  // Uma tarefa visível a toda a equipa pode ser vista por qualquer membro,
  // mas só quem está diretamente envolvido nela (atribuído, responsável
  // extra, responsável do projeto ou admin) pode comentar ou enviar
  // ficheiros — os restantes ficam em modo só-leitura.
  const podeInteragir = podeInteragirComTarefaAtiva();
  document.getElementById("aviso-so-leitura-tarefa").style.display = podeInteragir ? "none" : "block";

  try {
    anexosAtivos = await api.get(`/api/tasks/${taskId}/anexos`);
    renderizarAnexos();
    const formAnexo = document.getElementById("form-anexo");
    if (formAnexo) formAnexo.style.display = podeInteragir ? "flex" : "none";
  } catch (err) {
    console.error("Erro ao carregar anexos:", err);
  }

  const comentarios = await api.get(`/api/comments/tarefa/${taskId}`);
  document.getElementById("lista-comentarios").innerHTML = "";
  comentarios.forEach(adicionarComentarioNaLista);
  const formComentario = document.getElementById("form-comentario");
  if (formComentario) formComentario.style.display = podeInteragir ? "flex" : "none";

  await Promise.all([
    carregarCamposPersonalizadosTarefa(taskId, podeInteragir),
    carregarDependencias(taskId, podeInteragir),
    carregarSubtarefas(taskId, podeInteragir),
    carregarCronometro(taskId),
  ]);

  document.getElementById("overlay-detalhe").classList.add("open");
}

// Mesma regra do servidor (ver src/lib/permissions.js: podeInteragirComTarefa),
// calculada aqui só para decidir o que mostrar — o servidor é sempre quem
// decide de verdade, isto é só para não mostrar um formulário que o pedido
// a seguir recusaria com 403.
function podeInteragirComTarefaAtiva() {
  if (!tarefaAtiva) return false;
  if (eu.role === "admin") return true;
  if (souDonoDoProjeto()) return true;
  if (tarefaAtiva.assignee_id === eu.id) return true;
  if (tarefaAtiva.sou_responsavel_tarefa) return true;
  return false;
}
function fecharModalDetalhe() {
  document.getElementById("overlay-detalhe").classList.remove("open");
  tarefaAtiva = null;
  if (intervaloCronometro) { clearInterval(intervaloCronometro); intervaloCronometro = null; }
}

// ---------------- Campos personalizados (Monday.com / Smartsheet) ----------------
async function carregarCamposPersonalizadosTarefa(taskId, podeInteragir) {
  const container = document.getElementById("det-campos-personalizados");
  if (!container) return;
  try {
    const campos = await api.get(`/api/tasks/${taskId}/campos`);
    if (campos.length === 0) {
      container.innerHTML = `<p class="sub" style="margin:0 0 14px">Sem campos personalizados neste projeto.</p>`;
      return;
    }
    container.innerHTML = campos.map((c) => {
      const valorAtual = c.value ?? "";
      let input;
      if (c.type === "lista") {
        const opcoes = Array.isArray(c.options) ? c.options : [];
        input = `<select data-campo-id="${c.field_id}" ${podeInteragir ? "" : "disabled"}>
          <option value="">—</option>
          ${opcoes.map((o) => `<option value="${escaparHtml(o)}" ${o === valorAtual ? "selected" : ""}>${escaparHtml(o)}</option>`).join("")}
        </select>`;
      } else {
        const tipo = c.type === "numero" ? "number" : c.type === "data" ? "date" : "text";
        input = `<input type="${tipo}" data-campo-id="${c.field_id}" value="${escaparHtml(valorAtual)}" ${podeInteragir ? "" : "disabled"} />`;
      }
      return `
        <div class="field" style="margin-bottom:10px">
          <label style="font-size:11.5px">${escaparHtml(c.name)}</label>
          ${input}
        </div>`;
    }).join("");

    container.querySelectorAll("[data-campo-id]").forEach((el) => {
      el.addEventListener("change", async () => {
        try {
          await api.put(`/api/tasks/${taskId}/campos/${el.dataset.campoId}`, { value: el.value || null });
        } catch (err) {
          mostrarToast(err.message);
        }
      });
    });
  } catch (err) {
    console.error("Erro ao carregar campos personalizados:", err);
  }
}

// ---------------- Dependências entre tarefas (Asana) ----------------
async function carregarDependencias(taskId, podeInteragir) {
  const lista = document.getElementById("det-dependencias");
  const select = document.getElementById("det-select-dependencia");
  const linha = select?.closest(".mt-form-linha");
  if (!lista || !select) return;
  try {
    const dependencias = await api.get(`/api/tasks/${taskId}/dependencias`);
    lista.innerHTML = dependencias.map((d) => `
      <span class="dependencia-chip ${d.concluida ? "concluida" : "bloqueada"}">
        ${d.concluida ? "✓" : "⏳"} ${escaparHtml(d.title)}
        ${souDonoDoProjeto() ? `<span data-rem-dep="${d.id}" style="cursor:pointer">✕</span>` : ""}
      </span>
    `).join("") || `<p class="sub" style="margin:0">Esta tarefa não depende de nenhuma outra.</p>`;

    lista.querySelectorAll("[data-rem-dep]").forEach((el) => {
      el.addEventListener("click", async () => {
        try {
          await api.del(`/api/tasks/${taskId}/dependencias/${el.dataset.remDep}`);
          carregarDependencias(taskId, podeInteragir);
        } catch (err) {
          mostrarToast(err.message);
        }
      });
    });

    // Opções: outras tarefas do mesmo projeto, exceto a própria e as já escolhidas
    const idsJaDependentes = new Set(dependencias.map((d) => d.id));
    const opcoes = estado.tarefas.filter((t) => t.id !== taskId && !idsJaDependentes.has(t.id) && !t.parent_task_id);
    select.innerHTML = opcoes.map((t) => `<option value="${t.id}">${escaparHtml(t.title)}</option>`).join("");
    if (linha) linha.style.display = souDonoDoProjeto() ? "flex" : "none";
  } catch (err) {
    console.error("Erro ao carregar dependências:", err);
  }
}

async function adicionarDependencia() {
  const select = document.getElementById("det-select-dependencia");
  if (!select || !select.value || !tarefaAtiva) return;
  try {
    await api.post(`/api/tasks/${tarefaAtiva.id}/dependencias`, { depends_on_task_id: select.value });
    carregarDependencias(tarefaAtiva.id, podeInteragirComTarefaAtiva());
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Subtarefas (Asana) ----------------
async function carregarSubtarefas(taskId, podeInteragir) {
  const lista = document.getElementById("det-subtarefas");
  const form = document.getElementById("form-subtarefa");
  if (!lista) return;
  try {
    const subtarefas = await api.get(`/api/tasks/${taskId}/subtarefas`);
    lista.innerHTML = subtarefas.map((s) => `
      <div class="subtarefa-row">
        <input type="checkbox" data-sub-id="${s.id}" ${s.is_done ? "checked" : ""} ${podeInteragir ? "" : "disabled"} />
        <span style="flex:1;cursor:pointer;${s.is_done ? "text-decoration:line-through;color:var(--ink-faint)" : ""}" data-abrir-sub="${s.id}">${escaparHtml(s.title)}</span>
      </div>
    `).join("") || `<p class="sub" style="margin:0">Sem subtarefas ainda.</p>`;

    lista.querySelectorAll("[data-sub-id]").forEach((el) => {
      el.addEventListener("change", () => alternarSubtarefaConcluida(el.dataset.subId, el.checked, taskId, podeInteragir));
    });
    lista.querySelectorAll("[data-abrir-sub]").forEach((el) => {
      el.addEventListener("click", () => abrirModalDetalhe(el.dataset.abrirSub));
    });

    if (form) form.style.display = souDonoDoProjeto() ? "flex" : "none";
  } catch (err) {
    console.error("Erro ao carregar subtarefas:", err);
  }
}

// Marcar/desmarcar uma subtarefa move-a para a coluna "concluído" do projeto
// (ou para a primeira coluna, ao desmarcar) — a mesma noção de "concluída"
// usada em todo o resto da aplicação (board_columns.is_done).
async function alternarSubtarefaConcluida(subId, concluida, taskId, podeInteragir) {
  const colunaAlvo = concluida
    ? estado.colunas.find((c) => c.is_done)
    : [...estado.colunas].sort((a, b) => a.position - b.position)[0];
  if (!colunaAlvo) { mostrarToast("Este projeto não tem uma coluna de 'concluído' definida."); return; }
  try {
    await api.patch(`/api/tasks/${subId}/mover`, { column_id: colunaAlvo.id, position: 0 });
    carregarSubtarefas(taskId, podeInteragir);
  } catch (err) {
    mostrarToast(err.message);
  }
}

document.getElementById("form-subtarefa")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("input-subtarefa");
  const titulo = input.value.trim();
  if (!titulo || !tarefaAtiva) return;
  try {
    await api.post(`/api/tasks/${tarefaAtiva.id}/subtarefas`, { title: titulo });
    input.value = "";
    carregarSubtarefas(tarefaAtiva.id, podeInteragirComTarefaAtiva());
  } catch (err) {
    mostrarToast(err.message);
  }
});

// ---------------- Cronómetro / registo de tempo (ClickUp) ----------------
async function carregarCronometro(taskId) {
  const botao = document.getElementById("btn-cronometro");
  const display = document.getElementById("cron-tempo-total");
  if (!botao || !display) return;
  if (intervaloCronometro) { clearInterval(intervaloCronometro); intervaloCronometro = null; }
  try {
    const { total_segundos, a_correr, a_correr_todos = [], agora } = await api.get(`/api/tasks/${taskId}/tempo`);
    const colTarefa = estado.colunas.find((c) => c.id === tarefaAtiva?.column_id);
    const bloqueada = !!colTarefa && (colTarefa.is_done || colTarefa.restricted);
    const automatica = !!colTarefa && !!colTarefa.timer_start && !bloqueada;
    const podeUsar = podeInteragirComTarefaAtiva();
    const reiniciar = document.getElementById("btn-cron-reiniciar");
    const aviso = document.getElementById("cron-aviso");

    // "Iniciar" e "Reiniciar" ficam inativos em colunas bloqueadas e em colunas de registo automático ("Parar" continua disponível)
    botao.style.display = podeUsar ? "" : "none";
    botao.disabled = !a_correr && (bloqueada || automatica);
    if (reiniciar) {
      reiniciar.style.display = podeUsar ? "" : "none";
      reiniciar.disabled = bloqueada || automatica || (total_segundos === 0 && a_correr_todos.length === 0);
    }
    if (aviso) {
      aviso.style.display = bloqueada || automatica ? "block" : "none";
      aviso.textContent = bloqueada
        ? "⏸️ O registo de tempo não conta em colunas protegidas nem em colunas concluídas."
        : "⏱️ Nesta coluna o registo de tempo é automático (começa quando a tarefa entra na coluna).";
    }

    // Relógio ao vivo (hh:mm:ss), corrigido pela hora do servidor
    const desvio = (agora || Date.now()) - Date.now();
    const inicios = a_correr_todos.map((r) => new Date(r.started_at).getTime());
    const decorrido = (hora) => inicios.reduce((soma, i) => soma + Math.max(0, Math.floor((hora - i) / 1000)), 0);
    const base = total_segundos - decorrido(agora || Date.now());
    const desenhar = () => { display.textContent = formatarRelogio(Math.max(0, base + decorrido(Date.now() + desvio))); };
    desenhar();
    if (inicios.length) intervaloCronometro = setInterval(desenhar, 1000);

    if (a_correr) { botao.textContent = "⏸️ Parar"; botao.dataset.entryId = a_correr.id; }
    else { botao.textContent = "▶️ Iniciar"; delete botao.dataset.entryId; }
  } catch (err) {
    console.error("Erro ao carregar o cronómetro:", err);
  }
}

function formatarRelogio(segundos) {
  const h = Math.floor(segundos / 3600), m = Math.floor((segundos % 3600) / 60), s = segundos % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

async function reiniciarCronometro() {
  if (!tarefaAtiva) return;
  if (!(await gpiConfirm("Reiniciar o registo de tempo desta tarefa? Todo o tempo já registado é apagado e o cronómetro pára."))) return;
  try {
    await api.post(`/api/tasks/${tarefaAtiva.id}/tempo/reiniciar`, {});
    mostrarToast("Registo de tempo reiniciado.");
    carregarCronometro(tarefaAtiva.id);
  } catch (err) {
    mostrarToast(err.message);
  }
}

function formatarDuracao(segundos) {
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${segundos}s`;
}

async function alternarCronometro() {
  if (!tarefaAtiva) return;
  const botao = document.getElementById("btn-cronometro");
  try {
    if (botao.dataset.entryId) {
      await api.post(`/api/tasks/tempo/${botao.dataset.entryId}/parar`, {});
    } else {
      await api.post(`/api/tasks/${tarefaAtiva.id}/tempo/iniciar`, {});
    }
    carregarCronometro(tarefaAtiva.id);
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Campos personalizados do projeto (gestão) ----------------
function abrirModalCamposPersonalizados() {
  renderizarListaCamposPersonalizados();
  document.getElementById("overlay-campos-personalizados").classList.add("open");
}
function fecharModalCamposPersonalizados() {
  document.getElementById("overlay-campos-personalizados").classList.remove("open");
}
async function renderizarListaCamposPersonalizados() {
  const container = document.getElementById("lista-campos-personalizados");
  try {
    camposPersonalizadosProjeto = await api.get(`/api/projects/${projectId}/campos`);
    container.innerHTML = camposPersonalizadosProjeto.map((c) => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">
        <span style="flex:1">${escaparHtml(c.name)} <span style="color:var(--ink-faint);font-size:11px">(${c.type})</span></span>
        <span data-rem-campo="${c.id}" style="cursor:pointer;color:var(--ink-faint)">🗑️</span>
      </div>
    `).join("") || `<p class="sub" style="margin:0">Ainda não há campos personalizados.</p>`;

    container.querySelectorAll("[data-rem-campo]").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!(await gpiConfirm("Eliminar este campo personalizado? Os valores guardados nas tarefas também se perdem."))) return;
        try {
          await api.del(`/api/projects/campos/${el.dataset.remCampo}`);
          renderizarListaCamposPersonalizados();
        } catch (err) {
          mostrarToast(err.message);
        }
      });
    });
  } catch (err) {
    mostrarToast(err.message);
  }
}
document.getElementById("cp-tipo")?.addEventListener("change", (e) => {
  document.getElementById("cp-opcoes").style.display = e.target.value === "lista" ? "block" : "none";
});
document.getElementById("form-novo-campo")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = document.getElementById("cp-nome").value.trim();
  const tipo = document.getElementById("cp-tipo").value;
  const opcoesTexto = document.getElementById("cp-opcoes").value.trim();
  const options = tipo === "lista" ? opcoesTexto.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
  if (!nome) return;
  try {
    await api.post(`/api/projects/${projectId}/campos`, { name: nome, type: tipo, options });
    document.getElementById("form-novo-campo").reset();
    document.getElementById("cp-opcoes").style.display = "none";
    renderizarListaCamposPersonalizados();
  } catch (err) {
    mostrarToast(err.message);
  }
});

// ---------------- Metas do projeto (ClickUp) ----------------
let metasCache = [];
async function carregarMetas() {
  try {
    metasCache = await api.get(`/api/projects/${projectId}/metas`);
    renderizarMetas();
  } catch (err) {
    mostrarToast(err.message);
  }
}
function renderizarMetas() {
  const container = document.getElementById("metas-lista");
  const termo = norm(document.getElementById("metas-busca").value.trim());
  const metas = metasCache.filter((m) => !termo || norm(`${m.name} ${m.description || ""}`).includes(termo));
  document.getElementById("metas-contagem").textContent = termo ? `${metas.length} de ${metasCache.length}` : `${metasCache.length} meta(s)`;
  {
    container.innerHTML = metas.map((m) => `
      <div class="meta-card">
        <div class="meta-card-topo">
          <div>
            <strong>${escaparHtml(m.name)}</strong>
            ${m.target_date ? `<div class="sub" style="margin:2px 0 0">Até ${formatarData(m.target_date)}</div>` : ""}
          </div>
          ${souDonoDoProjeto() ? `<span data-rem-meta="${m.id}" style="cursor:pointer;color:var(--ink-faint)" title="Eliminar meta">🗑️</span>` : ""}
        </div>
        ${m.description ? `<p class="sub" style="margin:0 0 8px">${escaparHtml(m.description)}</p>` : ""}
        <div class="meta-progresso-barra"><div class="meta-progresso-fill" style="width:${m.progresso}%"></div></div>
        <div class="sub" style="margin:0 0 10px">${m.tarefas_concluidas}/${m.total_tarefas} tarefas concluídas (${m.progresso}%)</div>
        ${souDonoDoProjeto() ? `
          <select data-meta-add-tarefa="${m.id}" style="width:100%;padding:7px 10px;font-size:12.5px">
            <option value="">+ Ligar uma tarefa a esta meta…</option>
            ${estado.tarefas.filter((t) => !t.parent_task_id).map((t) => `<option value="${t.id}">${escaparHtml(t.title)}</option>`).join("")}
          </select>` : ""}
      </div>
    `).join("") || `<p class="sub">${metasCache.length ? "Nenhuma meta corresponde à pesquisa." : "Ainda não há metas definidas para este projeto."}</p>`;

    container.querySelectorAll("[data-rem-meta]").forEach((el) => {
      el.addEventListener("click", async () => {
        if (!(await gpiConfirm("Eliminar esta meta?"))) return;
        try { await api.del(`/api/projects/metas/${el.dataset.remMeta}`); carregarMetas(); }
        catch (err) { mostrarToast(err.message); }
      });
    });
    container.querySelectorAll("[data-meta-add-tarefa]").forEach((el) => {
      el.addEventListener("change", async () => {
        if (!el.value) return;
        try {
          await api.put(`/api/projects/metas/${el.dataset.metaAddTarefa}/tarefas/${el.value}`, {});
          carregarMetas();
        } catch (err) {
          mostrarToast(err.message);
        }
      });
    });
  }
}
function abrirModalNovaMeta() {
  document.getElementById("overlay-nova-meta").classList.add("open");
}
function fecharModalNovaMeta() {
  document.getElementById("overlay-nova-meta").classList.remove("open");
  document.getElementById("form-nova-meta").reset();
}
document.getElementById("form-nova-meta")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api.post(`/api/projects/${projectId}/metas`, {
      name: document.getElementById("meta-nome").value.trim(),
      description: document.getElementById("meta-descricao").value.trim() || null,
      target_date: document.getElementById("meta-data").value || null,
    });
    fecharModalNovaMeta();
    carregarMetas();
  } catch (err) {
    mostrarToast(err.message);
  }
});

function renderizarEtiquetasDetalhe() {
  const container = document.getElementById("det-etiquetas");
  const ativas = new Set((tarefaAtiva.labels || []).map((l) => l.id));
  const paletaCores = ["#22C7DD", "#F0B429", "#8E44AD", "#34C77B", "#EF6461", "#3498DB"];
  const podeGerirEtiquetas = souDonoDoProjeto();

  container.innerHTML = etiquetasProjeto.map((l) => `
    <span style="display:inline-flex;align-items:center;gap:5px;background:${ativas.has(l.id) ? l.color + "22" : "transparent"};color:${l.color};border:1px solid ${l.color};font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px">
      <span class="chip-toggle-det" data-id="${l.id}" style="cursor:pointer;user-select:none">${l.name}</span>
      ${podeGerirEtiquetas ? `<span data-del-label="${l.id}" style="cursor:pointer;opacity:0.7">✕</span>` : ""}
    </span>
  `).join("") + (podeGerirEtiquetas ? `<span id="nova-etiqueta-btn" style="cursor:pointer;user-select:none;background:transparent;color:var(--ink-faint);border:1px dashed var(--border);font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px">+ Nova etiqueta</span>` : "");

  if (podeGerirEtiquetas) {
    document.getElementById("nova-etiqueta-btn").addEventListener("click", async () => {
      const r = await gpiPrompt({
        titulo: "Nova etiqueta", icone: "🏷️",
        texto: "As etiquetas ajudam a organizar e filtrar as tarefas do projeto.",
        campo: { rotulo: "Nome da etiqueta", placeholder: "Ex: Urgente, Backend, Design", maxlength: 40 },
        cores: paletaCores, corInicial: paletaCores[etiquetasProjeto.length % paletaCores.length], confirmar: "Criar etiqueta",
      });
      if (!r) return;
      let label;
      try { label = await api.post(`/api/projects/${projectId}/etiquetas`, { name: r.valor, color: r.cor }); }
      catch (err) { mostrarToast(err.message); return; }
      etiquetasProjeto.push(label);
      renderizarSeletorEtiquetasFiltro();
      renderizarEtiquetasDetalhe();
    });
  }

  container.querySelectorAll(".chip-toggle-det").forEach((chip) => {
    if (!souDonoDoProjeto()) { chip.style.cursor = "default"; return; }
    chip.addEventListener("click", async () => {
      const id = chip.dataset.id;
      const atuais = new Set((tarefaAtiva.labels || []).map((l) => l.id));
      if (atuais.has(id)) atuais.delete(id); else atuais.add(id);
      const labels = await api.put(`/api/tasks/${tarefaAtiva.id}/etiquetas`, { label_ids: [...atuais] });
      tarefaAtiva.labels = labels;
      const idxT = estado.tarefas.findIndex((t) => t.id === tarefaAtiva.id);
      if (idxT > -1) estado.tarefas[idxT].labels = labels;
      renderizarEtiquetasDetalhe();
      renderizarQuadro();
    });
  });

  container.querySelectorAll("[data-del-label]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await gpiConfirm("Eliminar esta etiqueta de todo o projeto?"))) return;
      try {
        await api.del(`/api/projects/etiquetas/${el.dataset.delLabel}`);
      } catch (err) {
        mostrarToast(err.message);
      }
    });
  });
}

// ---------------- Responsáveis extra da tarefa ----------------
async function carregarResponsaveisExtra(taskId) {
  const podeGerir = souDonoDoProjeto();
  const extras = await api.get(`/api/tasks/${taskId}/responsaveis`);

  document.getElementById("det-responsaveis-extra").innerHTML = extras.map((u) => `
    <span style="display:inline-flex;align-items:center;gap:6px;background:var(--navy-900);border:1px solid var(--border);border-radius:20px;padding:3px 10px;font-size:11.5px">
      <span class="avatar" style="width:18px;height:18px;font-size:9px;background:${u.avatar_color || corPara(u.id)}">${iniciais(u.name)}</span>
      ${u.name}
      ${podeGerir ? `<span style="cursor:pointer;color:var(--ink-faint)" onclick="removerResponsavelExtra('${taskId}','${u.id}')">✕</span>` : ""}
    </span>
  `).join("") || `<span style="font-size:12px;color:var(--ink-faint)">Só o responsável principal, por agora.</span>`;

  const bloco = document.getElementById("det-add-responsavel");
  bloco.style.display = podeGerir ? "flex" : "none";
  if (podeGerir) {
    const idsJaResponsaveis = new Set(extras.map((u) => u.id));
    document.getElementById("det-select-responsavel").innerHTML = estado.membros
      .filter((m) => !idsJaResponsaveis.has(m.id))
      .map((m) => `<option value="${m.id}">${m.name}</option>`).join("") || `<option value="">Sem mais membros</option>`;
  }
}

async function adicionarResponsavelExtra() {
  const userId = document.getElementById("det-select-responsavel").value;
  if (!userId || !tarefaAtiva) return;
  try {
    await api.post(`/api/tasks/${tarefaAtiva.id}/responsaveis`, { user_id: userId });
    await carregarResponsaveisExtra(tarefaAtiva.id);
    mostrarToast("Responsável adicionado à tarefa.");
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function removerResponsavelExtra(taskId, userId) {
  try {
    await api.del(`/api/tasks/${taskId}/responsaveis/${userId}`);
    await carregarResponsaveisExtra(taskId);
  } catch (err) {
    mostrarToast(err.message);
  }
}

function renderizarChecklist() {
  const total = checklistAtiva.length;
  const feitos = checklistAtiva.filter((i) => i.is_done).length;
  document.getElementById("det-checklist-progresso").textContent = total > 0 ? `${feitos} de ${total} concluídos` : "Sem itens ainda.";

  // Só responsáveis do projeto ou administradores podem marcar/remover itens
  const podeMarcar = souDonoDoProjeto();

  document.getElementById("lista-checklist").innerHTML = checklistAtiva.map((i) => `
    <div style="display:flex;align-items:center;gap:9px;padding:6px 2px">
      <input type="checkbox" data-id="${i.id}" ${i.is_done ? "checked" : ""} ${podeMarcar ? "" : "disabled"} style="width:16px;height:16px;accent-color:var(--cyan)" />
      <span style="flex:1;font-size:13.5px;${i.is_done ? "text-decoration:line-through;color:var(--ink-faint)" : ""}">${i.content}</span>
      ${podeMarcar ? `<span data-del="${i.id}" style="cursor:pointer;color:var(--ink-faint);font-size:13px">✕</span>` : ""}
    </div>
  `).join("");

  if (!podeMarcar) return;
  document.querySelectorAll("#lista-checklist input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      try {
        await api.patch(`/api/tasks/checklist/${cb.dataset.id}`, { is_done: cb.checked });
      } catch (err) {
        cb.checked = !cb.checked;
        mostrarToast(err.message);
      }
    });
  });
  document.querySelectorAll("#lista-checklist [data-del]").forEach((el) => {
    el.addEventListener("click", async () => {
      try {
        await api.del(`/api/tasks/checklist/${el.dataset.del}`);
        checklistAtiva = checklistAtiva.filter((i) => i.id !== el.dataset.del);
        renderizarChecklist();
      } catch (err) {
        mostrarToast(err.message);
      }
    });
  });
}

function renderizarAnexos() {
  const container = document.getElementById("lista-anexos");
  if (!container) return;
  container.innerHTML = anexosAtivos.length
    ? anexosAtivos.map((a) => `
      <div style="display:flex;align-items:center;gap:9px;padding:7px 2px;border-bottom:1px solid var(--border)">
        <span style="font-size:16px">📎</span>
        <div style="flex:1;min-width:0">
          <a href="/api/tasks/anexos/${a.id}/download?token=${encodeURIComponent(sessao.obterToken())}" target="_blank" rel="noopener" style="color:var(--cyan);font-size:13px;font-weight:600;text-decoration:none;word-break:break-all">${a.file_name}</a>
          <div style="font-size:11px;color:var(--ink-faint)">${formatarTamanhoFicheiro(a.file_size)} · enviado por ${a.enviado_por_nome} · ${new Date(a.created_at).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
        </div>
      </div>
    `).join("")
    : `<div style="font-size:12.5px;color:var(--ink-faint)">Ainda não foi enviado nenhum ficheiro nesta tarefa.</div>`;
}

function adicionarComentarioNaLista(c) {
  const lista = document.getElementById("lista-comentarios");
  const el = document.createElement("div");
  el.className = "comment-item";
  el.dataset.commentId = c.id;
  const dataFormatada = new Date(c.created_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
  const podeEliminar = c.user_id === eu.id || souDonoDoProjeto();
  el.innerHTML = `
    <div class="avatar" style="background:${corPara(c.user_id)};width:26px;height:26px;font-size:11px">${iniciais(c.user_name)}</div>
    <div class="bubble">
      <div class="who">${c.user_name}<span class="when">${dataFormatada}</span></div>
      ${c.content}
      ${podeEliminar ? `<span data-del-comment="${c.id}" style="float:right;cursor:pointer;color:var(--ink-faint);font-size:11px;margin-left:8px">eliminar</span>` : ""}
    </div>
  `;
  lista.appendChild(el);
  lista.scrollTop = lista.scrollHeight;

  el.querySelector("[data-del-comment]")?.addEventListener("click", async () => {
    if (!(await gpiConfirm("Eliminar este comentário?"))) return;
    try {
      await api.del(`/api/comments/${c.id}`);
      el.remove();
    } catch (err) {
      mostrarToast(err.message);
    }
  });
}

// ---------------- Formulários ----------------
function ligarFormularios() {
  ["coluna-is-done", "coluna-restricted"].forEach((id) => document.getElementById(id).addEventListener("change", sincronizarOpcaoTimerColuna));
  document.getElementById("form-coluna").addEventListener("submit", async (e) => {
    e.preventDefault();
    const erroBox = document.getElementById("erro-coluna");
    erroBox.style.display = "none";
    const nome = document.getElementById("coluna-nome").value.trim();
    const isDone = document.getElementById("coluna-is-done").checked;
    const restricted = document.getElementById("coluna-restricted").checked;
    const timer_start = !isDone && !restricted && document.getElementById("coluna-timer").checked;
    if (!nome) return;

    try {
      if (colunaEmEdicao) {
        const atualizada = await api.patch(`/api/projects/colunas/${colunaEmEdicao}`, { name: nome, is_done: isDone, restricted, timer_start });
        estado.colunas = estado.colunas.map((c) => (c.id === atualizada.id ? { ...c, ...atualizada } : (isDone ? { ...c, is_done: false } : c)));
      } else {
        const nova = await api.post(`/api/projects/${projectId}/colunas`, { name: nome, is_done: isDone, restricted, timer_start });
        if (isDone) estado.colunas = estado.colunas.map((c) => ({ ...c, is_done: false }));
        if (!estado.colunas.some((c) => c.id === nova.id)) estado.colunas.push(nova);
      }
      renderizarQuadro();
      fecharModalColuna();
    } catch (err) {
      erroBox.textContent = err.message;
      erroBox.style.display = "block";
    }
  });

  let aCriarTarefa = false;
  document.getElementById("nt-grupo-ativo").addEventListener("change", (e) => {
    const op = document.getElementById("nt-grupo-opcoes");
    op.style.display = e.target.checked ? "block" : "none";
    if (e.target.checked) {
      const resp = document.getElementById("nt-responsavel").value;
      const cb = resp && document.querySelector(`#nt-grupo-membros input[value="${resp}"]`);
      if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
      document.getElementById("nt-grupo-nome").focus();
    }
  });
  document.getElementById("nt-responsavel").addEventListener("change", (e) => {
    if (!document.getElementById("nt-grupo-ativo").checked || !e.target.value) return;
    const cb = document.querySelector(`#nt-grupo-membros input[value="${e.target.value}"]`);
    if (cb && !cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); }
  });

  document.getElementById("form-nova-tarefa").addEventListener("submit", async (e) => {
    e.preventDefault();
    // Evita criar a tarefa em duplicado se a pessoa clicar/submeter duas vezes
    // seguidas antes do primeiro pedido terminar.
    if (aCriarTarefa) return;
    aCriarTarefa = true;
    const botao = e.target.querySelector("button[type=submit]");
    if (botao) botao.disabled = true;
    try {
      const nova = await api.post("/api/tasks", {
        project_id: projectId,
        column_id: document.getElementById("nt-coluna").value,
        title: document.getElementById("nt-titulo").value,
        priority: document.getElementById("nt-prioridade").value,
        assignee_id: document.getElementById("nt-responsavel").value || null,
        due_date: document.getElementById("nt-prazo").value || null,
        start_date: document.getElementById("nt-inicio").value || null,
        visibility: document.getElementById("nt-visibilidade").value,
      });
      if (etiquetasSelecionadasNaTarefaNova.size > 0) {
        nova.labels = await api.put(`/api/tasks/${nova.id}/etiquetas`, { label_ids: [...etiquetasSelecionadasNaTarefaNova] });
      }
      for (const texto of checklistNovaTarefa) {
        await api.post(`/api/tasks/${nova.id}/checklist`, { content: texto });
      }
      estado.tarefas.push(nova);
      renderizarQuadro();
      // Grupo de conversa da tarefa (opcional): a falha aqui não desfaz a tarefa.
      if (document.getElementById("nt-grupo-ativo").checked && souDonoDoProjeto()) {
        try {
          const { member_ids, responsavel_ids } = lerSeletorMembros("nt-grupo-membros");
          const nome = document.getElementById("nt-grupo-nome").value.trim() || `Tarefa: ${nova.title}`.slice(0, 80);
          await api.post(`/api/projects/${projectId}/grupos`, { name: nome, task_id: nova.id, member_ids, responsavel_ids });
          mostrarToast(`Tarefa e grupo "${nome}" criados.`);
          if (vistasCarregadas.has("conversa")) carregarGruposCanal();
        } catch (errGrupo) {
          mostrarToast(`Tarefa criada, mas o grupo falhou: ${errGrupo.message}`);
        }
      }
      fecharModalTarefa();
    } catch (err) {
      mostrarToast(err.message);
    } finally {
      aCriarTarefa = false;
      if (botao) botao.disabled = false;
    }
  });

  document.getElementById("form-editar-tarefa").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!tarefaAtiva) return;
    try {
      const payload = {
        title: document.getElementById("et-titulo").value,
        description: document.getElementById("et-descricao").value,
        priority: document.getElementById("et-prioridade").value,
        assignee_id: document.getElementById("et-responsavel").value || null,
        due_date: document.getElementById("et-prazo").value || null,
        start_date: document.getElementById("et-inicio").value || null,
      };
      if (document.getElementById("campo-et-visibilidade").style.display !== "none") {
        payload.visibility = document.getElementById("et-visibilidade").value;
      }
      await api.patch(`/api/tasks/${tarefaAtiva.id}`, payload);
      mostrarToast("Tarefa atualizada.");
      fecharModalDetalhe();
    } catch (err) {
      mostrarToast(err.message);
    }
  });

  document.getElementById("btn-eliminar-tarefa").addEventListener("click", async () => {
    if (!tarefaAtiva) return;
    if (!(await gpiConfirm(`Eliminar definitivamente a tarefa "${tarefaAtiva.title}"?`))) return;
    try {
      await api.del(`/api/tasks/${tarefaAtiva.id}`);
      estado.tarefas = estado.tarefas.filter((t) => t.id !== tarefaAtiva.id);
      renderizarQuadro();
      fecharModalDetalhe();
    } catch (err) {
      mostrarToast(err.message);
    }
  });

  document.getElementById("form-comentario").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("input-comentario");
    if (!input.value.trim() || !tarefaAtiva) return;
    const c = await api.post("/api/comments", { task_id: tarefaAtiva.id, content: input.value.trim() });
    adicionarComentarioNaLista(c);
    input.value = "";
  });

  document.getElementById("input-comentario").addEventListener("input", () => {
    if (tarefaAtiva) socket.emit("comment:digitando", { projectId, taskId: tarefaAtiva.id });
  });

  document.getElementById("channel-input").addEventListener("input", () => {
    socket.emit("channel:digitando", { projectId, grupoId: grupoAtivo });
  });

  document.getElementById("channel-pesquisa").addEventListener("input", () => renderizarFeedCanal());
  const ligaFiltro = (id, fn, ev = "input") => document.getElementById(id).addEventListener(ev, fn);
  ["lista-busca"].forEach((id) => ligaFiltro(id, debounce(renderizarListaTarefas)));
  ["lista-f-coluna", "lista-f-prio"].forEach((id) => ligaFiltro(id, renderizarListaTarefas, "change"));
  document.getElementById("lista-limpar").addEventListener("click", () => {
    ["lista-busca", "lista-f-coluna", "lista-f-prio"].forEach((id) => (document.getElementById(id).value = ""));
    renderizarListaTarefas();
  });
  ligaFiltro("dia-busca", debounce(renderizarListaModalDia, 120));
  ligaFiltro("metas-busca", debounce(renderizarMetas));
  ligaFiltro("auto-busca", debounce(renderizarAutomacoes));
  iniciarFiltrosCalendario();
  document.getElementById("btn-channel-selecionar").addEventListener("click", () => (modoSelecao ? sairModoSelecao() : entrarModoSelecao()));

  let aAdicionarItemChecklist = false;
  document.getElementById("form-checklist").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("input-checklist");
    if (!input.value.trim() || !tarefaAtiva) return;
    // Evita adicionar o item em duplicado com um duplo-clique/duplo-Enter
    if (aAdicionarItemChecklist) return;
    aAdicionarItemChecklist = true;
    const texto = input.value.trim();
    input.value = "";
    try {
      const item = await api.post(`/api/tasks/${tarefaAtiva.id}/checklist`, { content: texto });
      checklistAtiva.push(item);
      renderizarChecklist();
    } catch (err) {
      mostrarToast(err.message);
      input.value = texto;
    } finally {
      aAdicionarItemChecklist = false;
    }
  });

  document.getElementById("form-anexo")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!tarefaAtiva) return;
    const inputFicheiro = document.getElementById("input-anexo");
    const ficheiro = inputFicheiro.files[0];
    if (!ficheiro) { mostrarToast("Selecione um ficheiro para enviar."); return; }

    const botao = document.getElementById("btn-enviar-anexo");
    botao.disabled = true;
    botao.textContent = "A enviar…";
    try {
      const formData = new FormData();
      formData.append("ficheiro", ficheiro);
      const anexo = await api.upload(`/api/tasks/${tarefaAtiva.id}/anexos`, formData);
      anexosAtivos.unshift(anexo);
      renderizarAnexos();
      inputFicheiro.value = "";
      mostrarToast("Ficheiro enviado ao responsável.");
    } catch (err) {
      mostrarToast(err.message);
    } finally {
      botao.disabled = false;
      botao.textContent = "📎 Enviar ao responsável";
    }
  });

  document.getElementById("conv-pesquisa").addEventListener("input", () => {
    clearTimeout(convDebounce);
    convDebounce = setTimeout(pesquisarUtilizadoresParaConvidar, 250);
  });
  document.getElementById("conv-ordenar").addEventListener("change", pesquisarUtilizadoresParaConvidar);
  document.getElementById("equipa-busca").addEventListener("input", debounce(renderizarEquipa, 120));
  document.getElementById("conv-enviar").addEventListener("click", convidarSelecionados);
  document.getElementById("conv-limpar").addEventListener("click", () => {
    convSelecionados.clear();
    document.querySelectorAll("#conv-resultados .conv-item").forEach((i) => { i.classList.remove("sel"); i.querySelector("input").checked = false; });
    atualizarBarraConvite();
  });
  document.getElementById("conv-todos").addEventListener("change", (e) => {
    resultadosConviteAtuais.forEach((u) => { if (e.target.checked) convSelecionados.set(u.id, u); else convSelecionados.delete(u.id); });
    document.querySelectorAll("#conv-resultados .conv-item").forEach((i) => { i.classList.toggle("sel", e.target.checked); i.querySelector("input").checked = e.target.checked; });
    atualizarBarraConvite();
  });
}

async function sair() {
  await api.post("/api/auth/logout");
  sessao.limpar();
  window.location.href = "/entrar.html";
}

// ============================================================
// Seletor de vistas — Quadro / Lista / Calendário / Conversa / Automações
// ============================================================
const vistasCarregadas = new Set();

function ligarSeletorVistas() {
  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => mudarVista(tab.dataset.view));
  });
  document.getElementById("auto-acao").addEventListener("change", alternarCamposAcaoAutomacao);
  document.getElementById("form-channel").addEventListener("submit", enviarMensagemCanal);

  document.getElementById("btn-channel-file").addEventListener("click", () => document.getElementById("channel-file-input").click());
  document.getElementById("channel-file-input").addEventListener("change", async (e) => {
    const ficheiro = e.target.files[0];
    if (ficheiro) await enviarMediaCanal(ficheiro, "ficheiro");
    e.target.value = "";
  });

  document.getElementById("btn-channel-image").addEventListener("click", () => document.getElementById("channel-image-input").click());
  document.getElementById("channel-image-input").addEventListener("change", async (e) => {
    const ficheiro = e.target.files[0];
    if (ficheiro) await enviarMediaCanal(ficheiro, "imagem");
    e.target.value = "";
  });

  document.getElementById("btn-channel-audio").addEventListener("click", alternarGravacaoAudio);
  document.getElementById("cal-anterior").addEventListener("click", () => { calMesAtual--; if (calMesAtual < 0) { calMesAtual = 11; calAnoAtual--; } renderizarCalendario(); });
  document.getElementById("cal-seguinte").addEventListener("click", () => { calMesAtual++; if (calMesAtual > 11) { calMesAtual = 0; calAnoAtual++; } renderizarCalendario(); });
}

function mudarVista(vista) {
  document.querySelectorAll(".view-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === vista));
  ["quadro", "lista", "calendario", "gantt", "metas", "equipa", "conversa", "automacoes"].forEach((v) => {
    document.getElementById(`view-${v}`).style.display = v === vista ? "" : "none";
  });
  if (vista === "lista") renderizarListaTarefas();
  if (vista === "calendario") renderizarCalendario();
  if (vista === "gantt") renderizarGantt();
  if (vista === "metas") carregarMetas();
  if (vista === "equipa") renderizarEquipa();
  if (vista === "conversa" && !vistasCarregadas.has("conversa")) { vistasCarregadas.add("conversa"); carregarCanal(); }
  if (vista === "automacoes" && !vistasCarregadas.has("automacoes")) { vistasCarregadas.add("automacoes"); carregarAutomacoes(); }
}

// ---------------- Pesquisa/filtros comuns ----------------
const norm = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const soData = (iso) => (iso ? String(iso).substring(0, 10) : "");

// ---------------- Vista de Lista ----------------
function renderizarListaTarefas() {
  const nomeColuna = (colId) => estado.colunas.find((c) => c.id === colId)?.name || "—";
  const selCol = document.getElementById("lista-f-coluna");
  if (selCol.options.length - 1 !== estado.colunas.length) {
    const v = selCol.value;
    selCol.innerHTML = `<option value="">Todas as colunas</option>` + estado.colunas.map((c) => `<option value="${c.id}">${escaparHtml(c.name)}</option>`).join("");
    selCol.value = v;
  }
  const termo = norm(document.getElementById("lista-busca").value.trim());
  const fCol = selCol.value, fPrio = document.getElementById("lista-f-prio").value;
  const todas = estado.tarefas.filter((t) => !t.parent_task_id);
  const visiveis = todas.filter((t) =>
    (!fCol || t.column_id === fCol) && (!fPrio || t.priority === fPrio) &&
    (!termo || norm(`${t.title} ${nomeColuna(t.column_id)} ${t.assignee_name || ""} ${t.priority}`).includes(termo)));
  document.getElementById("lista-contagem").textContent = visiveis.length === todas.length ? `${todas.length} tarefa(s)` : `${visiveis.length} de ${todas.length}`;
  document.getElementById("tbody-lista-tarefas").innerHTML = visiveis.map((t, i) => `
    <tr style="cursor:pointer" onclick="abrirModalDetalhe('${t.id}')">
      <td>${i + 1}</td>
      <td style="font-weight:600">${escaparHtml(t.title)}</td>
      <td>${escaparHtml(nomeColuna(t.column_id))}</td>
      <td><span class="prio prio-${t.priority}" style="display:inline-block">${t.priority}</span></td>
      <td>${escaparHtml(t.assignee_name || "—")}</td>
      <td style="color:var(--ink-faint);font-size:12.5px">${t.due_date ? formatarData(t.due_date) : "—"}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-faint)">${todas.length ? "Nenhuma tarefa corresponde à pesquisa." : "Sem tarefas neste projeto."}</td></tr>`;
}

// ---------------- Vista de Calendário ----------------
const hoje = new Date();
let calMesAtual = hoje.getMonth();
let calAnoAtual = hoje.getFullYear();
const NOMES_MES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function renderizarCalendario() {
  document.getElementById("cal-titulo-mes").textContent = `${NOMES_MES[calMesAtual]} ${calAnoAtual}`;
  document.getElementById("cal-cabecalho").innerHTML = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d) => `<div>${d}</div>`).join("");

  const primeiroDia = new Date(calAnoAtual, calMesAtual, 1);
  const inicioGrelha = new Date(primeiroDia);
  inicioGrelha.setDate(inicioGrelha.getDate() - primeiroDia.getDay());

  sincronizarControlosCalendario();
  const filtradas = tarefasCalendarioFiltradas();
  const fDe = document.getElementById("cal-f-de").value, fAte = document.getElementById("cal-f-ate").value;
  const tarefasPorDia = new Map();
  filtradas.forEach((t) => {
    const chave = new Date(soData(t.due_date) + "T00:00:00").toDateString();
    if (!tarefasPorDia.has(chave)) tarefasPorDia.set(chave, []);
    tarefasPorDia.get(chave).push(t);
  });

  let html = "";
  for (let i = 0; i < 42; i++) {
    const dia = new Date(inicioGrelha);
    dia.setDate(dia.getDate() + i);
    const foraDoMes = dia.getMonth() !== calMesAtual;
    const iso = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
    const noPeriodo = (fDe || fAte) && (!fDe || iso >= fDe) && (!fAte || iso <= fAte);
    const ehHoje = dia.toDateString() === hoje.toDateString();
    const tarefasDoDia = tarefasPorDia.get(dia.toDateString()) || [];
    const chaveDia = dia.toDateString();
    const COR = { alta: "alta", media: "media", baixa: "baixa" };
    const previa = tarefasDoDia.slice(0, 6).map((t) => `<div class="cal-previa-item"><span class="cal-bolinha prio-${COR[t.priority] || "media"}"></span><span>${escaparHtml(t.title)}</span></div>`).join("")
      + (tarefasDoDia.length > 6 ? `<div class="cal-previa-mais">+${tarefasDoDia.length - 6} mais…</div>` : "");
    html += `
      <div class="cal-day ${foraDoMes ? "fora-do-mes" : ""} ${ehHoje ? "hoje" : ""} ${tarefasDoDia.length ? "com-tarefas" : ""} ${noPeriodo ? "no-periodo" : ""} ${(fDe || fAte) && !noPeriodo ? "fora-periodo" : ""}" data-iso="${iso}" ${tarefasDoDia.length ? `onclick="abrirModalDia('${chaveDia}')" tabindex="0" role="button" aria-label="${tarefasDoDia.length} tarefa(s) em ${dia.getDate()}"` : ""}>
        <div class="num">${dia.getDate()}</div>
        ${tarefasDoDia.length ? `
          <div class="cal-resumo">
            <span class="cal-contagem">${tarefasDoDia.length}</span>
            <span class="cal-bolinhas">${tarefasDoDia.slice(0, 4).map((t) => `<span class="cal-bolinha prio-${COR[t.priority] || "media"}"></span>`).join("")}</span>
          </div>
          <div class="cal-previa"><div class="cal-previa-titulo">${dia.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" })} · ${tarefasDoDia.length} tarefa${tarefasDoDia.length > 1 ? "s" : ""}</div>${previa}<div class="cal-previa-dica">Clique para ver todas</div></div>` : ""}
      </div>`;
    if (i === 41) break;
  }
  document.getElementById("cal-corpo").innerHTML = html;
  calTarefasPorDia = tarefasPorDia;
}

let calTarefasPorDia = new Map();

function idsColunasConcluidas() { return new Set(estado.colunas.filter((c) => c.is_done).map((c) => c.id)); }
function tarefasCalendarioFiltradas() {
  const termo = norm(document.getElementById("cal-busca").value.trim());
  const prio = document.getElementById("cal-f-prio").value;
  const resp = document.getElementById("cal-f-resp").value;
  const est = document.getElementById("cal-f-estado").value;
  const de = document.getElementById("cal-f-de").value, ate = document.getElementById("cal-f-ate").value;
  const feitas = idsColunasConcluidas();
  const hojeIso = new Date().toISOString().substring(0, 10);
  const hojeLocal = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  return estado.tarefas.filter((t) => {
    if (!t.due_date || t.parent_task_id) return false;
    const d = soData(t.due_date);
    if (de && d < de) return false;
    if (ate && d > ate) return false;
    if (prio && t.priority !== prio) return false;
    if (resp && t.assignee_id !== resp) return false;
    const concl = feitas.has(t.column_id);
    if (est === "concluida" && !concl) return false;
    if (est === "pendente" && concl) return false;
    if (est === "atrasada" && (concl || d >= hojeLocal)) return false;
    if (termo && !norm(`${t.title} ${t.assignee_name || ""}`).includes(termo)) return false;
    return true;
  });
}

function sincronizarControlosCalendario() {
  const selMes = document.getElementById("cal-sel-mes"), selAno = document.getElementById("cal-sel-ano");
  if (!selMes.options.length) selMes.innerHTML = NOMES_MES.map((n, i) => `<option value="${i}">${n}</option>`).join("");
  const anos = new Set([calAnoAtual - 1, calAnoAtual, calAnoAtual + 1, new Date().getFullYear() - 2, new Date().getFullYear() + 2]);
  estado.tarefas.forEach((t) => { if (t.due_date) anos.add(Number(soData(t.due_date).substring(0, 4))); });
  const lista = [...anos].filter((a) => a > 1999 && a < 2100).sort((a, b) => a - b);
  if (selAno.options.length !== lista.length || selAno.dataset.sig !== lista.join()) { selAno.innerHTML = lista.map((a) => `<option value="${a}">${a}</option>`).join(""); selAno.dataset.sig = lista.join(); }
  selMes.value = calMesAtual; selAno.value = calAnoAtual;
  const sel = document.getElementById("cal-f-resp");
  if (sel.options.length - 1 !== estado.membros.length) {
    const v = sel.value;
    sel.innerHTML = `<option value="">Todos os responsáveis</option>` + estado.membros.map((m) => `<option value="${m.id}">${escaparHtml(m.name)}</option>`).join("");
    sel.value = v;
  }
  // resumo
  const de = document.getElementById("cal-f-de").value, ate = document.getElementById("cal-f-ate").value;
  const filtradas = tarefasCalendarioFiltradas();
  const ativos = ["cal-busca", "cal-f-prio", "cal-f-resp", "cal-f-estado", "cal-f-de", "cal-f-ate"].some((id) => document.getElementById(id).value);
  const fmt = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
  const nAtivos = ["cal-busca", "cal-f-prio", "cal-f-resp", "cal-f-estado", "cal-f-de", "cal-f-ate"].filter((id) => document.getElementById(id).value).length;
  const bn = document.getElementById("cal-filtros-n"); bn.textContent = nAtivos || ""; bn.style.display = nAtivos ? "inline-flex" : "none";
  const resumo = document.getElementById("cal-resumo-filtro");
  resumo.innerHTML = ativos
    ? `<i class="bi bi-funnel-fill"></i> <strong>${filtradas.length}</strong> tarefa${filtradas.length === 1 ? "" : "s"} com os filtros aplicados${de || ate ? ` · período ${de ? "de " + fmt(de) : ""}${ate ? " até " + fmt(ate) : ""}` : ""}`
    : "";
  resumo.style.display = ativos ? "block" : "none";
  document.getElementById("cal-f-lista").style.display = de || ate ? "" : "none";
}

function iniciarFiltrosCalendario() {
  const refresh = () => renderizarCalendario();
  document.getElementById("cal-filtros-toggle").addEventListener("click", (e) => {
    const w = document.getElementById("cal-filtros-wrap");
    const aberto = w.classList.toggle("aberto");
    e.currentTarget.setAttribute("aria-expanded", aberto);
    e.currentTarget.classList.toggle("aberto", aberto);
  });
  document.getElementById("cal-busca").addEventListener("input", debounce(refresh));
  ["cal-f-prio", "cal-f-resp", "cal-f-estado"].forEach((id) => document.getElementById(id).addEventListener("change", refresh));
  document.getElementById("cal-sel-mes").addEventListener("change", (e) => { calMesAtual = Number(e.target.value); refresh(); });
  document.getElementById("cal-sel-ano").addEventListener("change", (e) => { calAnoAtual = Number(e.target.value); refresh(); });
  document.getElementById("cal-hoje").addEventListener("click", () => { const h = new Date(); calMesAtual = h.getMonth(); calAnoAtual = h.getFullYear(); refresh(); });
  // Período: ao escolher "de", salta para esse mês
  const periodo = () => {
    const de = document.getElementById("cal-f-de").value, ate = document.getElementById("cal-f-ate").value;
    if (de && ate && de > ate) { document.getElementById("cal-f-ate").value = de; }
    const alvo = document.getElementById("cal-f-de").value || document.getElementById("cal-f-ate").value;
    if (alvo) { const d = new Date(alvo + "T00:00:00"); calMesAtual = d.getMonth(); calAnoAtual = d.getFullYear(); }
    refresh();
  };
  document.getElementById("cal-f-de").addEventListener("change", periodo);
  document.getElementById("cal-f-ate").addEventListener("change", periodo);
  // Ir para o dia: salta para o mês, destaca o dia e abre as tarefas dele (se houver)
  document.getElementById("cal-f-dia").addEventListener("change", (e) => {
    if (!e.target.value) return;
    const d = new Date(e.target.value + "T00:00:00");
    calMesAtual = d.getMonth(); calAnoAtual = d.getFullYear();
    refresh();
    const cel = document.querySelector(`#cal-corpo .cal-day[data-iso="${e.target.value}"]:not(.fora-do-mes)`);
    if (cel) { cel.classList.add("destaque-dia"); cel.scrollIntoView({ behavior: "smooth", block: "center" }); setTimeout(() => cel.classList.remove("destaque-dia"), 2200); if (cel.classList.contains("com-tarefas")) setTimeout(() => cel.click(), 500); }
  });
  document.getElementById("cal-f-limpar").addEventListener("click", () => {
    ["cal-busca", "cal-f-prio", "cal-f-resp", "cal-f-estado", "cal-f-de", "cal-f-ate", "cal-f-dia"].forEach((id) => (document.getElementById(id).value = ""));
    refresh();
  });
  // Lista de todas as tarefas do período, numa janela
  document.getElementById("cal-f-lista").addEventListener("click", () => {
    const tarefas = tarefasCalendarioFiltradas().sort((a, b) => soData(a.due_date).localeCompare(soData(b.due_date)));
    abrirListaTarefasModal(`Tarefas do período (${tarefas.length})`, tarefas, true);
  });
}
// Janela com lista de tarefas (dia ou período) + pesquisa
let tarefasModalDia = [];
function abrirListaTarefasModal(titulo, tarefas, mostrarData) {
  tarefasModalDia = tarefas.map((t) => ({ t, mostrarData }));
  document.getElementById("titulo-modal-dia").textContent = titulo;
  const busca = document.getElementById("dia-busca");
  busca.value = "";
  document.getElementById("dia-busca-box").style.display = tarefas.length > 1 ? "block" : "none";
  renderizarListaModalDia();
  document.getElementById("overlay-dia").classList.add("open");
  if (tarefas.length > 1 && window.matchMedia("(hover: hover)").matches) setTimeout(() => busca.focus(), 350);
}
function renderizarListaModalDia() {
  const termo = norm(document.getElementById("dia-busca").value.trim());
  const itens = tarefasModalDia.filter(({ t }) => {
    const col = estado.colunas.find((c) => c.id === t.column_id)?.name || "";
    return !termo || norm(`${t.title} ${col} ${t.assignee_name || ""} ${t.priority}`).includes(termo);
  });
  document.getElementById("dia-contagem").textContent = termo ? `${itens.length} de ${tarefasModalDia.length}` : `${tarefasModalDia.length} tarefas`;
  document.getElementById("lista-tarefas-dia").innerHTML = itens.map(({ t, mostrarData }) => {
    const nomeColuna = estado.colunas.find((c) => c.id === t.column_id)?.name || "—";
    return `
      <div class="tarefa-dia-item" onclick="fecharModalDia();abrirModalDetalhe('${t.id}')">
        <span class="prio prio-${t.priority}" style="margin:0">${t.priority}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:13.5px">${escaparHtml(t.title)}</div>
          <div style="font-size:11.5px;color:var(--ink-faint)">${mostrarData ? formatarData(t.due_date) + " · " : ""}${escaparHtml(nomeColuna)}${t.assignee_name ? " · " + escaparHtml(t.assignee_name) : ""}</div>
        </div>
      </div>`;
  }).join("") || `<div class="sub">${tarefasModalDia.length ? "Nenhuma tarefa corresponde à pesquisa." : "Sem tarefas."}</div>`;
}
function abrirModalDia(chaveDia) {
  const dia = new Date(chaveDia);
  abrirListaTarefasModal(`Tarefas de ${dia.toLocaleDateString("pt-PT", { weekday: "long", day: "2-digit", month: "long" })}`, calTarefasPorDia.get(chaveDia) || [], false);
}
function fecharModalDia() {
  document.getElementById("overlay-dia").classList.remove("open");
}

// ---------------- Vista de Conversa da equipa ----------------
async function carregarCanal() {
  await carregarGruposCanal();
  await carregarMensagensGrupo();
}

async function carregarGruposCanal() {
  try { gruposCanal = await api.get(`/api/projects/${projectId}/grupos`); } catch { gruposCanal = []; }
  renderizarGruposCanal();
}

async function carregarMensagensGrupo() {
  const g = grupoAtivo ? gruposCanal.find((x) => x.id === grupoAtivo) : null;
  const form = document.getElementById("form-channel");
  if (g && !g.sou_membro) {
    // Gestor que ainda não entrou neste grupo: não vê o conteúdo.
    mensagensCanalCache = [];
    document.getElementById("channel-feed").innerHTML = `
      <div class="empty-rich" style="margin:auto">
        <div style="font-size:34px">🔒</div>
        <h4>Ainda não faz parte de "${escaparHtml(g.name)}"</h4>
        <p class="sub">Como responsável, pode entrar no grupo para ler e escrever.</p>
        <button class="btn btn-primary" style="width:auto" onclick="entrarNoGrupo('${g.id}')">Entrar no grupo</button>
      </div>`;
    form.style.display = "none";
    renderizarFixadas();
    renderizarInfoGrupo();
    return;
  }
  form.style.display = "";
  mensagensCanalCache = await api.get(`/api/projects/${projectId}/mensagens${grupoAtivo ? `?grupo=${grupoAtivo}` : ""}`);
  renderizarFeedCanal({ manterScroll: false });
  renderizarFixadas();
  renderizarInfoGrupo();
}

async function selecionarGrupo(id) {
  sairModoSelecao();
  cancelarResposta();
  grupoAtivo = id;
  gruposNaoLidos.delete(id || "geral");
  document.getElementById("channel-pesquisa").value = "";
  document.getElementById("channel-digitando").innerHTML = "";
  renderizarGruposCanal();
  try { await carregarMensagensGrupo(); } catch (err) { mostrarToast(err.message); }
}

async function entrarNoGrupo(id) {
  try {
    await api.post(`/api/projects/grupos/${id}/entrar`, {});
    await carregarGruposCanal();
    await carregarMensagensGrupo();
  } catch (err) { mostrarToast(err.message); }
}

async function sairDoGrupo() {
  if (!grupoAtivo || !(await gpiConfirm("Sair deste grupo? Deixa de receber as mensagens dele."))) return;
  try {
    await api.post(`/api/projects/grupos/${grupoAtivo}/sair`, {});
    await carregarGruposCanal();
    await selecionarGrupo(null);
  } catch (err) { mostrarToast(err.message); }
}

function renderizarGruposCanal() {
  const box = document.getElementById("channel-grupos");
  if (!box) return;
  const chip = (id, rotulo, titulo, bloqueado) => `
    <button type="button" class="grupo-chip ${grupoAtivo === id ? "ativo" : ""}" onclick="selecionarGrupo(${id ? `'${id}'` : "null"})" title="${escaparHtml(titulo || rotulo)}">
      ${bloqueado ? '<i class="bi bi-lock-fill"></i>' : id ? '<i class="bi bi-people-fill"></i>' : '<i class="bi bi-hash"></i>'}
      <span>${escaparHtml(rotulo)}</span>${gruposNaoLidos.has(id || "geral") ? '<span class="grupo-ponto"></span>' : ""}
    </button>`;
  box.innerHTML = chip(null, "Geral", "Conversa de toda a equipa") +
    gruposCanal.map((g) => chip(g.id, g.name, g.task_title ? `Tarefa: ${g.task_title}` : g.name, !g.sou_membro)).join("") +
    (souDonoDoProjeto() ? `<button type="button" class="grupo-chip novo" onclick="abrirModalGrupo()"><i class="bi bi-plus-lg"></i> <span>Novo grupo</span></button>` : "");
}

function renderizarInfoGrupo() {
  const box = document.getElementById("channel-grupo-info");
  const g = grupoAtivo ? gruposCanal.find((x) => x.id === grupoAtivo) : null;
  if (!g) { box.style.display = "none"; return; }
  box.style.display = "flex";
  box.innerHTML = `
    <div style="min-width:0"><strong>${escaparHtml(g.name)}</strong>
      <span class="sub"> · ${g.total_membros} membro(s)${g.task_title ? ` · 🗂 ${escaparHtml(g.task_title)}` : ""}</span></div>
    <span style="margin-left:auto;display:flex;gap:6px;flex-shrink:0">
      ${souDonoDoProjeto() || g.sou_resp_grupo ? `<button type="button" class="mini-btn" onclick="abrirModalGrupo('${g.id}')"><i class="bi bi-gear"></i> Gerir</button>` : ""}
      ${g.sou_membro ? `<button type="button" class="mini-btn" onclick="sairDoGrupo()"><i class="bi bi-box-arrow-right"></i> Sair</button>` : ""}
    </span>`;
}

// ---------------- Mensagens fixadas ----------------
function renderizarFixadas() {
  const box = document.getElementById("channel-fixadas");
  if (!box) return;
  const fixadas = mensagensCanalCache.filter((m) => m.pinned_at && !m.deleted_at)
    .sort((a, b) => new Date(b.pinned_at) - new Date(a.pinned_at));
  if (fixadas.length === 0) { box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  const texto = (m) => escaparHtml((m.type === "texto" ? m.content : `📎 ${m.file_name || m.type}`) || "").slice(0, 120);
  const linha = (m) => `
    <div class="fixada-item" onclick="irParaMensagem('${m.id}')">
      <i class="bi bi-pin-angle-fill"></i>
      <div style="min-width:0;flex:1"><div class="fixada-autor">${escaparHtml(m.autor_nome)}</div><div class="fixada-texto">${texto(m)}</div></div>
      ${souDonoDoProjeto() ? `<button type="button" class="mini-btn" style="margin:0" title="Desafixar" onclick="event.stopPropagation();fixarMensagem('${m.id}')"><i class="bi bi-pin-angle"></i></button>` : ""}
    </div>`;
  box.innerHTML = `
    <div class="fixadas-topo" onclick="fixadasAbertas=!fixadasAbertas;renderizarFixadas()">
      <i class="bi bi-pin-angle-fill"></i> <strong>${fixadas.length} fixada${fixadas.length > 1 ? "s" : ""}</strong>
      ${fixadasAbertas ? "" : `<span class="fixada-previa">${texto(fixadas[0])}</span>`}
      <i class="bi bi-chevron-${fixadasAbertas ? "up" : "down"}" style="margin-left:auto"></i>
    </div>
    ${fixadasAbertas ? `<div class="fixadas-lista">${fixadas.map(linha).join("")}</div>` : ""}`;
}

function irParaMensagem(id) {
  const pesq = document.getElementById("channel-pesquisa");
  if (pesq.value) { pesq.value = ""; renderizarFeedCanal({ manterScroll: false }); }
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) { mostrarToast("Mensagem fora do histórico carregado."); return; }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("destaque");
  setTimeout(() => el.classList.remove("destaque"), 1800);
}

function atualizarMarcaFixada(id) {
  const m = mensagensCanalCache.find((x) => x.id === id);
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!m || !el) return;
  el.classList.toggle("fixada", !!m.pinned_at);
  const meta = el.querySelector(".meta");
  meta?.querySelector(".channel-pin-tag")?.remove();
  if (m.pinned_at && meta) meta.insertAdjacentHTML("beforeend", `<span class="channel-pin-tag" title="Mensagem fixada"><i class="bi bi-pin-angle-fill"></i> fixada</span>`);
  const item = el.querySelector("[data-acao-fixar]");
  if (item) item.innerHTML = m.pinned_at ? "📌 Desafixar" : "📌 Fixar";
}

async function fixarMensagem(id) {
  document.querySelector(`.channel-msg[data-msg-id="${id}"]`)?.classList.remove("menu-aberto");
  try { await api.post(`/api/projects/mensagens/${id}/fixar`, {}); } catch (err) { mostrarToast(err.message); }
  // O resultado chega a todos via socket ("channel:pin").
}

// ---------------- Modo de seleção (copiar / eliminar várias) ----------------
function entrarModoSelecao(idInicial) {
  modoSelecao = true;
  mensagensSelecionadas.clear();
  if (idInicial) mensagensSelecionadas.add(idInicial);
  document.getElementById("channel-feed").classList.add("modo-selecao");
  document.getElementById("channel-selecao-bar").style.display = "flex";
  document.getElementById("form-channel").style.display = "none";
  cancelarResposta();
  document.querySelectorAll(".channel-msg.menu-aberto").forEach((e) => e.classList.remove("menu-aberto"));
  sincronizarSelecaoNoDom();
}
function sairModoSelecao() {
  if (!modoSelecao) return;
  modoSelecao = false;
  mensagensSelecionadas.clear();
  document.getElementById("channel-feed").classList.remove("modo-selecao");
  document.getElementById("channel-selecao-bar").style.display = "none";
  const g = grupoAtivo ? gruposCanal.find((x) => x.id === grupoAtivo) : null;
  document.getElementById("form-channel").style.display = g && !g.sou_membro ? "none" : "";
  sincronizarSelecaoNoDom();
}
function alternarSelecao(id) {
  if (mensagensSelecionadas.has(id)) mensagensSelecionadas.delete(id); else mensagensSelecionadas.add(id);
  sincronizarSelecaoNoDom();
}
function selecionarTodasVisiveis() {
  const todas = [...document.querySelectorAll("#channel-feed .channel-msg:not(.eliminada)")].map((e) => e.dataset.msgId);
  const todasJa = todas.length > 0 && todas.every((i) => mensagensSelecionadas.has(i));
  mensagensSelecionadas.clear();
  if (!todasJa) todas.forEach((i) => mensagensSelecionadas.add(i));
  sincronizarSelecaoNoDom();
}
function sincronizarSelecaoNoDom() {
  document.querySelectorAll("#channel-feed .channel-msg").forEach((el) => {
    const sel = mensagensSelecionadas.has(el.dataset.msgId);
    el.classList.toggle("selecionada", sel);
    const cb = el.querySelector(".channel-sel-box");
    if (cb) cb.checked = sel;
  });
  atualizarBarraSelecao();
}
function atualizarBarraSelecao() {
  const n = mensagensSelecionadas.size;
  const c = document.getElementById("channel-sel-contagem");
  if (c) c.textContent = n === 1 ? "1 selecionada" : `${n} selecionadas`;
  ["btn-sel-copiar", "btn-sel-eliminar"].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = n === 0; });
}
document.addEventListener("click", (e) => {
  if (!modoSelecao) return;
  const msg = e.target.closest("#channel-feed .channel-msg");
  if (!msg || msg.classList.contains("eliminada")) return;
  if (e.target.closest("a, audio, .channel-msg-acoes")) { if (!e.target.closest(".channel-sel-box")) return; }
  e.preventDefault();
  if (e.target.classList.contains("channel-sel-box")) { alternarSelecao(msg.dataset.msgId); return; }
  alternarSelecao(msg.dataset.msgId);
});

async function copiarSelecionadas() {
  const lista = mensagensCanalCache.filter((m) => mensagensSelecionadas.has(m.id))
    .map((m) => `[${new Date(m.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}] ${m.autor_nome}: ${m.type === "texto" ? m.content : `(${m.type}) ${m.file_name || ""}`}`);
  try {
    await navigator.clipboard.writeText(lista.join("\n"));
    mostrarToast(`${lista.length} mensagem(ns) copiada(s).`);
    sairModoSelecao();
  } catch { mostrarToast("Não foi possível copiar."); }
}

// Regras: só minhas → "para todos" ou "para mim"; com mensagens de outros
// (ou mistas) → apenas "para mim".
function abrirEliminarSelecionadas() {
  const sel = mensagensCanalCache.filter((m) => mensagensSelecionadas.has(m.id));
  if (sel.length === 0) return;
  const soMinhas = sel.every((m) => m.user_id === eu.id);
  document.getElementById("sel-del-titulo").textContent = `Eliminar ${sel.length} mensagem${sel.length > 1 ? "ns" : ""}`;
  document.getElementById("sel-del-texto").textContent = soMinhas
    ? "Todas as mensagens selecionadas são suas: pode eliminá-las só para si ou para todos."
    : "A seleção inclui mensagens de outras pessoas, por isso só pode eliminá-las para si. Os outros continuam a vê-las.";
  document.getElementById("sel-del-todos").style.display = soMinhas ? "block" : "none";
  document.getElementById("overlay-eliminar-selecao").classList.add("open");
}
function fecharEliminarSelecionadas() { document.getElementById("overlay-eliminar-selecao").classList.remove("open"); }
async function confirmarEliminarSelecionadas(escopo) {
  const ids = [...mensagensSelecionadas];
  try {
    await api.post("/api/projects/mensagens/eliminar", { ids, escopo });
    if (escopo === "mim") {
      mensagensCanalCache = mensagensCanalCache.filter((m) => !ids.includes(m.id));
      renderizarFeedCanal();
      renderizarFixadas();
    }
    // "todos" chega via socket ("channel:message-deleted") para cada mensagem.
    fecharEliminarSelecionadas();
    sairModoSelecao();
  } catch (err) {
    mostrarToast(err.message);
    fecharEliminarSelecionadas();
  }
}

// ---------------- Grupos: criar / gerir ----------------
let grupoEmEdicao = null;
async function abrirModalGrupo(groupId, taskIdPre) {
  grupoEmEdicao = groupId || null;
  document.getElementById("grupo-erro").style.display = "none";
  document.getElementById("grupo-modal-titulo").textContent = groupId ? "Gerir grupo" : "Novo grupo";
  document.getElementById("btn-grupo-eliminar").style.display = groupId ? "inline-flex" : "none";
  document.getElementById("grupo-campo-tarefa").style.display = groupId ? "none" : "block";
  const selTarefa = document.getElementById("grupo-tarefa");
  selTarefa.innerHTML = `<option value="">— Nenhuma —</option>` + estado.tarefas.filter((t) => !t.parent_task_id)
    .map((t) => `<option value="${t.id}">${escaparHtml(t.title)}</option>`).join("");
  selTarefa.value = taskIdPre || "";
  document.getElementById("grupo-nome").value = "";

  let marcados = new Set();
  let respSet = new Set();
  let candidatos = estado.membros;
  if (groupId) {
    try {
      const r = await api.get(`/api/projects/grupos/${groupId}/membros`);
      document.getElementById("grupo-nome").value = r.grupo.name;
      candidatos = r.membros;
      marcados = new Set(r.membros.filter((m) => m.no_grupo).map((m) => m.id));
      respSet = new Set(r.membros.filter((m) => m.resp).map((m) => m.id));
    } catch (err) { mostrarToast(err.message); return; }
  } else if (taskIdPre) {
    const t = estado.tarefas.find((x) => x.id === taskIdPre);
    document.getElementById("grupo-nome").value = t ? `Tarefa: ${t.title}`.slice(0, 80) : "";
    if (t?.assignee_id) marcados.add(t.assignee_id);
  }
  marcados.add(eu.id); respSet.add(eu.id);
  renderizarSeletorMembros("grupo-membros", candidatos, marcados, respSet, atualizarContagemGrupo);
  document.getElementById("overlay-grupo").classList.add("open");
}
// ---- Seletor de membros (checkbox + ★ responsável do grupo), usado nas duas janelas
function renderizarSeletorMembros(boxId, candidatos, marcados, resp, aoMudar) {
  const box = document.getElementById(boxId);
  box.innerHTML = candidatos.map((m, i) => `
    <label class="grupo-membro" style="--i:${i}" data-uid="${m.id}">
      <input type="checkbox" value="${m.id}" ${marcados.has(m.id) ? "checked" : ""} ${m.id === eu.id ? "disabled" : ""} />
      <span class="avatar" style="width:26px;height:26px;font-size:10px;background:${m.avatar_color || corPara(m.id)}">${iniciais(m.name)}</span>
      <span class="grupo-membro-nome">${escaparHtml(m.name)}${m.id === eu.id ? " (você)" : ""}</span>
      <button type="button" class="grupo-resp-btn ${resp.has(m.id) || m.id === eu.id ? "ativo" : ""}" ${m.id === eu.id ? "disabled" : ""} title="Responsável do grupo">★<span> Responsável</span></button>
    </label>`).join("");
  const sincronizar = () => {
    box.querySelectorAll(".grupo-membro").forEach((l) => {
      const marcado = l.querySelector("input").checked;
      l.classList.toggle("on", marcado);
      const b = l.querySelector(".grupo-resp-btn");
      b.style.visibility = marcado ? "visible" : "hidden";
    });
    aoMudar?.();
  };
  box.querySelectorAll("input").forEach((i) => i.addEventListener("change", () => {
    if (!i.checked) i.closest(".grupo-membro").querySelector(".grupo-resp-btn").classList.remove("ativo");
    sincronizar();
  }));
  box.querySelectorAll(".grupo-resp-btn").forEach((b) => b.addEventListener("click", (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (!b.disabled) b.classList.toggle("ativo");
  }));
  sincronizar();
}
function lerSeletorMembros(boxId) {
  const member_ids = [], responsavel_ids = [];
  document.querySelectorAll(`#${boxId} .grupo-membro`).forEach((l) => {
    if (!l.querySelector("input").checked) return;
    member_ids.push(l.dataset.uid);
    if (l.querySelector(".grupo-resp-btn").classList.contains("ativo")) responsavel_ids.push(l.dataset.uid);
  });
  return { member_ids, responsavel_ids };
}

function atualizarContagemGrupo() {
  const n = document.querySelectorAll("#grupo-membros input:checked").length;
  document.getElementById("grupo-contagem").textContent = `(${n} selecionado${n === 1 ? "" : "s"})`;
}
function fecharModalGrupo() { document.getElementById("overlay-grupo").classList.remove("open"); }

async function guardarGrupo() {
  const erro = document.getElementById("grupo-erro");
  erro.style.display = "none";
  const name = document.getElementById("grupo-nome").value.trim();
  if (!name) { erro.textContent = "Dê um nome ao grupo."; erro.style.display = "block"; return; }
  const { member_ids, responsavel_ids } = lerSeletorMembros("grupo-membros");
  try {
    if (grupoEmEdicao) {
      await api.put(`/api/projects/grupos/${grupoEmEdicao}`, { name });
      await api.put(`/api/projects/grupos/${grupoEmEdicao}/membros`, { member_ids, responsavel_ids });
      fecharModalGrupo();
      await carregarGruposCanal();
      renderizarInfoGrupo();
    } else {
      const g = await api.post(`/api/projects/${projectId}/grupos`, { name, member_ids, responsavel_ids, task_id: document.getElementById("grupo-tarefa").value || undefined });
      fecharModalGrupo();
      await carregarGruposCanal();
      vistasCarregadas.add("conversa");
      mudarVista("conversa");
      await selecionarGrupo(g.id);
    }
  } catch (err) { erro.textContent = err.message; erro.style.display = "block"; }
}

async function eliminarGrupo() {
  if (!grupoEmEdicao || !(await gpiConfirm("Eliminar este grupo e todas as suas mensagens? Isto não pode ser desfeito."))) return;
  try {
    await api.del(`/api/projects/grupos/${grupoEmEdicao}`);
    fecharModalGrupo();
    await carregarGruposCanal();
    if (grupoAtivo === grupoEmEdicao) await selecionarGrupo(null);
  } catch (err) { mostrarToast(err.message); }
}

// Botão "Grupo da tarefa" no detalhe da tarefa (só responsáveis/admin)
async function abrirGrupoDaTarefa() {
  if (!tarefaAtiva) return;
  const taskId = tarefaAtiva.id;
  try { await carregarGruposCanal(); } catch {}
  const g = gruposCanal.find((x) => x.task_id === taskId);
  if (!g) { fecharModalDetalhe(); await abrirModalGrupo(null, taskId); return; }
  fecharModalDetalhe();
  vistasCarregadas.add("conversa");
  mudarVista("conversa");
  await selecionarGrupo(g.id);
}
function atualizarBotaoGrupoTarefa() {
  const sec = document.getElementById("det-sec-grupo");
  if (!sec) return;
  sec.style.display = souDonoDoProjeto() && tarefaAtiva && !tarefaAtiva.parent_task_id ? "block" : "none";
}

// Pesquisar na conversa (Slack): filtra localmente pelo texto da mensagem ou
// nome do ficheiro — a conversa de um projeto é pequena o suficiente para não
// precisar de pedir isto ao servidor. Mensagens eliminadas nunca aparecem
// numa pesquisa, já que o conteúdo delas deixou de existir para mostrar.
function renderizarFeedCanal({ manterScroll = true } = {}) {
  const feed = document.getElementById("channel-feed");
  const termo = (document.getElementById("channel-pesquisa")?.value || "").trim().toLowerCase();
  const pertoDoFim = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;

  const lista = !termo ? mensagensCanalCache : mensagensCanalCache.filter((m) => {
    if (m.deleted_at) return false;
    const alvo = m.type === "texto" ? m.content : m.file_name;
    return (alvo || "").toLowerCase().includes(termo);
  });

  feed.innerHTML = lista.map(criarBolhaCanal).join("") || (termo
    ? `<div class="sub" style="text-align:center;margin-top:20px">Sem mensagens com "${escaparHtml(termo)}".</div>`
    : `<div class="sub" style="text-align:center;margin-top:20px">Ainda não há mensagens nesta conversa.</div>`);

  if (!termo && (manterScroll ? pertoDoFim : true)) feed.scrollTop = feed.scrollHeight;
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
}

// Realça menções "@Nome" no texto da mensagem (mesmas regras de deteção do
// servidor: compara com o primeiro nome dos membros do projeto).
function realcarMencoes(texto) {
  const escapado = escaparHtml(texto);
  const primeirosNomes = (estado.membros || []).map((m) => m.name.split(" ")[0]);
  return escapado.replace(/@(\w+)/g, (match, nome) =>
    primeirosNomes.some((n) => n.toLowerCase() === nome.toLowerCase())
      ? `<span class="channel-mention">${match}</span>` : match
  );
}

const EMOJIS_REACAO = ["👍", "❤️", "😂", "🎉", "😮", "👀"];

function criarBolhaCanal(m) {
  const minha = m.user_id === eu?.id;
  const eliminada = !!m.deleted_at;
  let conteudo = "";
  const urlComToken = m.url ? `${m.url}?token=${encodeURIComponent(sessao.obterToken())}` : null;

  if (eliminada) {
    conteudo = `<div class="bubble">Mensagem eliminada</div>`;
  } else if (m.type === "imagem") {
    conteudo = `<img class="channel-media-img" src="${urlComToken}" alt="${escaparHtml(m.file_name || "imagem")}" onclick="window.open('${urlComToken}', '_blank')" />`;
  } else if (m.type === "audio") {
    conteudo = `<audio class="channel-audio-player" controls src="${urlComToken}"></audio>`;
  } else if (m.type === "ficheiro") {
    conteudo = `<div class="channel-file-chip">
      <a class="channel-file-abrir" href="${urlComToken}" target="_blank" rel="noopener" title="Abrir">📎 ${escaparHtml(m.file_name)}</a>
      <span class="channel-file-tam">${formatarTamanhoFicheiro(m.file_size || 0)}</span>
      <a class="channel-file-baixar" href="${urlComToken}&baixar=1" download="${escaparHtml(m.file_name)}" title="Descarregar">⬇</a></div>`;
  } else {
    conteudo = `<div class="bubble">${realcarMencoes(m.content)}</div>`;
  }

  // Responder (Slack): mostra uma pré-visualização da mensagem original por
  // cima da bolha. "reply_to_id" null (não respondeu) ou a mensagem original
  // já não existir/for de outro tipo não mostra nada.
  const citacao = !eliminada && m.reply_to_id && m.reply_to_preview
    ? `<div class="channel-msg-reply-preview">↩ ${escaparHtml(m.reply_to_autor)}: ${escaparHtml((m.reply_to_preview || "").slice(0, 80))}</div>`
    : "";

  // Reações: agrupa por emoji, mostra a contagem, e destaca as que a própria
  // pessoa já deu (clicar de novo remove-a — o servidor é que alterna). A
  // caixa fica sempre presente (mesmo vazia) com um id próprio, para que o
  // evento de socket "channel:reaction" a possa atualizar diretamente sem
  // ter de redesenhar a mensagem toda.
  const reacoes = eliminada ? "" : `<div class="reacoes-box" id="reacoes-${m.id}">${construirChipsReacao(m.reacoes, m.id)}</div>`;

  // Ações: copiar/editar só fazem sentido em mensagens de texto ainda não
  // eliminadas; eliminar está sempre disponível (a própria pessoa escolhe
  // depois se é só para si ou para todos — "para todos" só é aceite pelo
  // servidor se for o autor ou um responsável do projeto/admin).
  const podeEliminarTodos = minha || souDonoDoProjeto();
  const gestor = souDonoDoProjeto();
  const acoes = eliminada ? "" : `
    <div class="channel-msg-acoes">
      <button type="button" class="channel-msg-acoes-btn" onclick="alternarEmojiPicker('${m.id}')" title="Reagir">🙂</button>
      <button type="button" class="channel-msg-acoes-btn" onclick="alternarMenuMensagem('${m.id}')" title="Mais ações">⋯</button>
      <div class="emoji-picker" id="emoji-picker-${m.id}">
        ${EMOJIS_REACAO.map((e) => `<span onclick="reagirMensagem('${m.id}', '${e}'); alternarEmojiPicker('${m.id}', false)">${e}</span>`).join("")}
      </div>
      <div class="channel-msg-menu">
        <div class="channel-msg-menu-item" onclick="responderMensagem('${m.id}')">↩️ Responder</div>
        ${m.type === "texto" ? `<div class="channel-msg-menu-item" onclick="copiarMensagem('${m.id}')">📋 Copiar</div>` : ""}
        ${gestor ? `<div class="channel-msg-menu-item" data-acao-fixar onclick="fixarMensagem('${m.id}')">📌 ${m.pinned_at ? "Desafixar" : "Fixar"}</div>` : ""}
        <div class="channel-msg-menu-item" onclick="entrarModoSelecao('${m.id}')">☑️ Selecionar</div>
        ${minha && m.type === "texto" ? `<div class="channel-msg-menu-item" onclick="iniciarEdicaoMensagem('${m.id}')">✏️ Editar</div>` : ""}
        <div class="channel-msg-menu-item perigo" onclick="pedirEliminarMensagem('${m.id}', ${podeEliminarTodos})">🗑️ Eliminar</div>
      </div>
    </div>`;

  return `
    <div class="channel-msg ${minha ? "mine" : ""} ${eliminada ? "eliminada" : ""} ${m.pinned_at && !eliminada ? "fixada" : ""} ${mensagensSelecionadas.has(m.id) ? "selecionada" : ""}" data-msg-id="${m.id}" data-content="${escaparHtml(m.content || "")}" data-autor="${escaparHtml(m.autor_nome)}">
      ${eliminada ? "" : `<input type="checkbox" class="channel-sel-box" ${mensagensSelecionadas.has(m.id) ? "checked" : ""} tabindex="-1" />`}
      <div class="avatar" style="width:28px;height:28px;font-size:11px;background:${m.avatar_color || corPara(m.user_id)}">${iniciais(m.autor_nome)}</div>
      <div style="flex:1;min-width:0">
        <div class="meta">${minha ? "Você" : m.autor_nome} · ${new Date(m.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${m.edited_at && !eliminada ? `<span class="channel-edited-tag">(editada)</span>` : ""}${m.pinned_at && !eliminada ? `<span class="channel-pin-tag" title="Mensagem fixada"><i class="bi bi-pin-angle-fill"></i> fixada</span>` : ""}</div>
        ${citacao}
        ${conteudo}
        ${reacoes}
      </div>
      ${acoes}
    </div>`;
}

// ---------------- Reações emoji (Slack) ----------------
function construirChipsReacao(reacoes, messageId) {
  if (!reacoes || reacoes.length === 0) return "";
  return Object.entries(reacoes.reduce((acc, r) => ((acc[r.emoji] = (acc[r.emoji] || []).concat(r.user_id)), acc), {}))
    .map(([emoji, userIds]) => `
      <span class="reacao-chip ${userIds.includes(eu?.id) ? "minha" : ""}" onclick="reagirMensagem('${messageId}', '${emoji}')" title="${userIds.length} reação(ões)">${emoji} ${userIds.length}</span>
    `).join("");
}

function alternarEmojiPicker(id, forcar) {
  document.querySelectorAll(".emoji-picker").forEach((p) => { if (p.id !== `emoji-picker-${id}`) p.style.display = "none"; });
  const picker = document.getElementById(`emoji-picker-${id}`);
  if (!picker) return;
  const abrir = forcar !== undefined ? forcar : picker.style.display !== "flex";
  picker.style.display = abrir ? "flex" : "none";
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".channel-msg-acoes")) return;
  document.querySelectorAll(".emoji-picker").forEach((p) => (p.style.display = "none"));
});

async function reagirMensagem(id, emoji) {
  try {
    await api.post(`/api/projects/mensagens/${id}/reacoes`, { emoji });
    // A atualização chega a todos (incluindo quem reagiu) via socket
    // ("channel:reaction"), por isso não mexemos aqui para evitar duplicar.
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Responder a uma mensagem (Slack) ----------------
let respostaAtiva = null;
function responderMensagem(id) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) return;
  el.classList.remove("menu-aberto");
  respostaAtiva = { id, autor: el.dataset.autor, preview: (el.dataset.content || "").slice(0, 80) };
  const barra = document.getElementById("channel-reply-bar");
  barra.innerHTML = `
    <span>↩ A responder a <strong>${escaparHtml(respostaAtiva.autor)}</strong>: ${escaparHtml(respostaAtiva.preview)}</span>
    <span class="fechar" onclick="cancelarResposta()">✕</span>`;
  barra.style.display = "flex";
  document.getElementById("channel-input")?.focus();
}
function cancelarResposta() {
  respostaAtiva = null;
  document.getElementById("channel-reply-bar").style.display = "none";
}

// Fecha qualquer menu de mensagem aberto ao clicar fora dele
document.addEventListener("click", (e) => {
  if (e.target.closest(".channel-msg-acoes")) return;
  document.querySelectorAll(".channel-msg.menu-aberto").forEach((el) => el.classList.remove("menu-aberto"));
});

function alternarMenuMensagem(id) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) return;
  const jaAberto = el.classList.contains("menu-aberto");
  document.querySelectorAll(".channel-msg.menu-aberto").forEach((e) => e.classList.remove("menu-aberto"));
  if (!jaAberto) el.classList.add("menu-aberto");
}

async function copiarMensagem(id) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.dataset.content || "");
    mostrarToast("Mensagem copiada.");
  } catch {
    mostrarToast("Não foi possível copiar a mensagem.");
  }
  el.classList.remove("menu-aberto");
}

function iniciarEdicaoMensagem(id) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) return;
  el.classList.remove("menu-aberto");
  const bubble = el.querySelector(".bubble");
  if (!bubble) return;
  const textoAtual = el.dataset.content || "";
  bubble.outerHTML = `
    <div class="bubble channel-msg-edicao">
      <input type="text" id="edicao-${id}" value="${escaparHtml(textoAtual)}" />
      <button type="button" class="btn btn-primary" onclick="guardarEdicaoMensagem('${id}')">Guardar</button>
      <button type="button" class="btn btn-ghost" onclick="cancelarEdicaoMensagem('${id}')">Cancelar</button>
    </div>`;
  document.getElementById(`edicao-${id}`)?.focus();
}

function cancelarEdicaoMensagem(id) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (!el) return;
  const edicao = el.querySelector(".channel-msg-edicao");
  if (edicao) edicao.outerHTML = `<div class="bubble">${escaparHtml(el.dataset.content || "")}</div>`;
}

async function guardarEdicaoMensagem(id) {
  const input = document.getElementById(`edicao-${id}`);
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) { mostrarToast("A mensagem não pode ficar vazia."); return; }
  try {
    await api.patch(`/api/projects/mensagens/${id}`, { content: texto });
    // A própria edição chega de volta via socket ("channel:message-edited"),
    // que já atualiza a bolha — não é preciso repetir aqui.
  } catch (err) {
    mostrarToast(err.message);
  }
}

let mensagemParaEliminar = null;
function pedirEliminarMensagem(id, podeTodos) {
  const el = document.querySelector(`.channel-msg[data-msg-id="${id}"]`);
  if (el) el.classList.remove("menu-aberto");
  mensagemParaEliminar = { id, podeTodos };
  document.querySelector('#overlay-eliminar-mensagem [onclick="confirmarEliminarMensagem(\'todos\')"]').style.display = podeTodos ? "block" : "none";
  document.getElementById("overlay-eliminar-mensagem").classList.add("open");
}
function fecharModalEliminarMensagem() {
  document.getElementById("overlay-eliminar-mensagem").classList.remove("open");
  mensagemParaEliminar = null;
}
async function confirmarEliminarMensagem(escopo) {
  if (!mensagemParaEliminar) return;
  const { id } = mensagemParaEliminar;
  try {
    await api.del(`/api/projects/mensagens/${id}?escopo=${escopo}`);
    if (escopo === "mim") {
      // Só esta pessoa deixa de ver a mensagem — os outros continuam a vê-la,
      // por isso não há evento de socket para isto, só removemos localmente.
      document.querySelector(`.channel-msg[data-msg-id="${id}"]`)?.remove();
    }
    // "todos" é aplicado a toda a gente (incluindo quem pediu) via socket
    // ("channel:message-deleted"), por isso não mexemos aqui para evitar
    // fazer o trabalho em duplicado.
  } catch (err) {
    mostrarToast(err.message);
  }
  fecharModalEliminarMensagem();
}

async function enviarMensagemCanal(e) {
  e.preventDefault();
  const input = document.getElementById("channel-input");
  const texto = input.value.trim();
  if (!texto) return;
  input.value = "";
  const reply_to_id = respostaAtiva?.id || undefined;
  cancelarResposta();
  await api.post(`/api/projects/${projectId}/mensagens`, { content: texto, reply_to_id, grupo_id: grupoAtivo || undefined });
  // A própria mensagem chega de volta via socket ("channel:message"), por isso
  // não a acrescentamos aqui — evita mostrá-la em duplicado.
}

async function enviarMediaCanal(file, tipo, duracaoSegundos) {
  const formData = new FormData();
  formData.append("ficheiro", file);
  formData.append("tipo", tipo);
  if (duracaoSegundos) formData.append("duracao", Math.round(duracaoSegundos));
  if (grupoAtivo) formData.append("grupo_id", grupoAtivo);
  try {
    await api.upload(`/api/projects/${projectId}/mensagens/multimedia`, formData);
  } catch (err) {
    mostrarToast(err.message);
  }
}

// ---------------- Gravação de áudio (estilo WhatsApp) ----------------
let gravadorAudio = null;
let pedacosAudio = [];
let inicioGravacao = 0;

async function alternarGravacaoAudio() {
  const btn = document.getElementById("btn-channel-audio");
  if (gravadorAudio && gravadorAudio.state === "recording") {
    gravadorAudio.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pedacosAudio = [];
    gravadorAudio = new MediaRecorder(stream);
    gravadorAudio.ondataavailable = (e) => pedacosAudio.push(e.data);
    gravadorAudio.onstop = async () => {
      const duracao = (Date.now() - inicioGravacao) / 1000;
      stream.getTracks().forEach((t) => t.stop());
      btn.classList.remove("gravando");
      if (duracao < 1) { mostrarToast("Gravação demasiado curta."); return; }
      const blob = new Blob(pedacosAudio, { type: "audio/webm" });
      const ficheiro = new File([blob], `audio-${Date.now()}.webm`, { type: "audio/webm" });
      await enviarMediaCanal(ficheiro, "audio", duracao);
    };
    inicioGravacao = Date.now();
    gravadorAudio.start();
    btn.classList.add("gravando");
    mostrarToast("A gravar — clique de novo no microfone para terminar.");
  } catch (err) {
    mostrarToast("Não foi possível aceder ao microfone.");
  }
}

// ---------------- Vista de Automações ----------------
const ROTULO_ACAO_AUTOMACAO = {
  notificar: (a) => `notifica ${a.notificar_nome || "o responsável do projeto"}`,
  atribuir: (a) => `atribui a tarefa a ${a.atribuir_nome || "—"}`,
  definir_prioridade: (a) => `muda a prioridade para ${{ alta: "🔴 Alta", media: "🟡 Média", baixa: "🟢 Baixa" }[a.set_priority] || a.set_priority}`,
  concluir_checklist: () => `marca toda a checklist como concluída`,
  iniciar_tempo: () => `inicia o registo de tempo do responsável da tarefa`,
};

async function carregarAutomacoes() {
  const selColuna = document.getElementById("auto-coluna");
  selColuna.innerHTML = estado.colunas.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  alternarCamposAcaoAutomacao();

  const selNotificar = document.getElementById("auto-notificar");
  selNotificar.innerHTML = `<option value="">O responsável do projeto</option>` +
    estado.membros.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");
  const selAtribuir = document.getElementById("auto-atribuir");
  selAtribuir.innerHTML = estado.membros.map((m) => `<option value="${m.id}">${m.name}</option>`).join("");

  // Só quem é dono do projeto (ou admin) pode criar — os restantes só veem a lista
  const souGestor = souDonoDoProjeto();
  document.getElementById("card-nova-automacao").style.display = souGestor ? "" : "none";

  automacoesCache = await api.get(`/api/projects/${projectId}/automacoes`);
  renderizarAutomacoes();
}
let automacoesCache = [];
function renderizarAutomacoes() {
  const souGestor = souDonoDoProjeto();
  const termo = norm(document.getElementById("auto-busca").value.trim());
  const automacoes = automacoesCache.filter((a) => !termo || norm(`${a.name} ${a.coluna_nome} ${(ROTULO_ACAO_AUTOMACAO[a.action_type] || ROTULO_ACAO_AUTOMACAO.notificar)(a)}`).includes(termo));
  document.getElementById("auto-contagem").textContent = termo ? `${automacoes.length} de ${automacoesCache.length}` : `${automacoesCache.length} automação(ões)`;
  document.getElementById("lista-automacoes").innerHTML = automacoes.map((a) => `
    <div class="report-card" style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <h3 style="margin-bottom:4px">⚡ ${a.name}</h3>
          <div style="font-size:12.5px;color:var(--ink-dim)">Quando entra em "${a.coluna_nome}" → ${(ROTULO_ACAO_AUTOMACAO[a.action_type] || ROTULO_ACAO_AUTOMACAO.notificar)(a)}</div>
        </div>
        ${souGestor ? `
          <div style="display:flex;gap:6px;align-items:center">
            <label style="display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--ink-faint);cursor:pointer">
              <input type="checkbox" ${a.active ? "checked" : ""} onchange="alternarAutomacao('${a.id}', this.checked)" /> Ativa
            </label>
            <span class="mini-btn danger" onclick="eliminarAutomacao('${a.id}')">Eliminar</span>
          </div>` : ""}
      </div>
    </div>
  `).join("") || `<div class="sub">${automacoesCache.length ? "Nenhuma automação corresponde à pesquisa." : "Ainda não há automações criadas neste projeto."}</div>`;
}

function alternarCamposAcaoAutomacao() {
  const tipo = document.getElementById("auto-acao").value;
  // "Iniciar registo de tempo" só pode disparar em colunas que não sejam concluídas nem protegidas
  const selCol = document.getElementById("auto-coluna");
  const anterior = selCol.value;
  const validas = tipo === "iniciar_tempo" ? estado.colunas.filter((c) => !c.is_done && !c.restricted) : estado.colunas;
  selCol.innerHTML = validas.map((c) => `<option value="${c.id}">${escaparHtml(c.name)}</option>`).join("");
  if (validas.some((c) => c.id === anterior)) selCol.value = anterior;
  document.getElementById("campo-auto-notificar").style.display = tipo === "notificar" ? "" : "none";
  document.getElementById("campo-auto-atribuir").style.display = tipo === "atribuir" ? "" : "none";
  document.getElementById("campo-auto-prioridade").style.display = tipo === "definir_prioridade" ? "" : "none";
}

async function criarAutomacao() {
  const name = document.getElementById("auto-nome").value.trim();
  const trigger_column_id = document.getElementById("auto-coluna").value;
  const action_type = document.getElementById("auto-acao").value;
  if (!name || !trigger_column_id) { mostrarToast("Dê um nome e escolha a coluna de gatilho."); return; }

  const payload = { name, trigger_column_id, action_type };
  if (action_type === "notificar") payload.notify_user_id = document.getElementById("auto-notificar").value || null;
  if (action_type === "atribuir") payload.assign_user_id = document.getElementById("auto-atribuir").value;
  if (action_type === "definir_prioridade") payload.set_priority = document.getElementById("auto-prioridade").value;

  try {
    await api.post(`/api/projects/${projectId}/automacoes`, payload);
    document.getElementById("auto-nome").value = "";
    mostrarToast("Automação criada.");
    await carregarAutomacoes();
  } catch (err) {
    mostrarToast(err.message);
  }
}

async function alternarAutomacao(id, active) {
  try {
    await api.patch(`/api/projects/automacoes/${id}`, { active });
  } catch (err) {
    mostrarToast(err.message);
    await carregarAutomacoes();
  }
}

async function eliminarAutomacao(id) {
  if (!(await gpiConfirm("Eliminar esta automação?"))) return;
  try {
    await api.del(`/api/projects/automacoes/${id}`);
    await carregarAutomacoes();
  } catch (err) {
    mostrarToast(err.message);
  }
}

iniciar();


// ---------------- Navegação horizontal do quadro ----------------
// O quadro tem altura limitada ao ecrã (as colunas rolam por dentro), por isso a
// barra horizontal está sempre visível. Além disso: setas laterais, atalhos de
// colunas, arrastar o fundo, rolagem automática ao arrastar tarefas e roda do rato.
function iniciarNavegacaoQuadro() {
  const cont = document.getElementById("board-columns");
  if (!cont || cont.dataset.navLigada) return;
  cont.dataset.navLigada = "1";
  const esq = document.getElementById("board-seta-esq");
  const dir = document.getElementById("board-seta-dir");
  const passo = () => Math.max(300, Math.round(cont.clientWidth * 0.8));

  esq.addEventListener("click", () => cont.scrollBy({ left: -passo(), behavior: "smooth" }));
  dir.addEventListener("click", () => cont.scrollBy({ left: passo(), behavior: "smooth" }));

  const atualizar = () => {
    const max = cont.scrollWidth - cont.clientWidth;
    esq.classList.toggle("visivel", cont.scrollLeft > 8);
    dir.classList.toggle("visivel", cont.scrollLeft < max - 8);
    // realça o atalho da coluna mais visível
    const cx = cont.getBoundingClientRect().left + 120;
    let ativa = null;
    cont.querySelectorAll(".column").forEach((c) => { if (c.getBoundingClientRect().left <= cx) ativa = c.dataset.colId; });
    document.querySelectorAll("#board-nav .board-nav-chip").forEach((b) => {
      const era = b.classList.contains("ativo");
      b.classList.toggle("ativo", b.dataset.col === ativa);
      // mantém o atalho da coluna atual visível dentro da própria barra (telemóvel)
      if (!era && b.dataset.col === ativa) {
        const nv = document.getElementById("board-nav");
        nv.scrollTo({ left: b.offsetLeft - nv.clientWidth / 2 + b.offsetWidth / 2, behavior: "smooth" });
      }
    });
  };
  cont.addEventListener("scroll", () => requestAnimationFrame(atualizar), { passive: true });
  window.addEventListener("resize", atualizar);

  const nav = document.getElementById("board-nav");
  const reconstruir = () => {
    const cols = [...cont.querySelectorAll(".column[data-col-id]")];
    const precisa = cont.scrollWidth > cont.clientWidth + 4 && cols.length > 1;
    nav.style.display = precisa ? "flex" : "none";
    nav.innerHTML = precisa ? `<span class="board-nav-rot"><i class="bi bi-layout-three-columns"></i> Ir para:</span>` + cols.map((c) => {
      const nome = c.querySelector(".column-head h4")?.textContent.trim() || "Coluna";
      const n = c.querySelector(".column-count")?.textContent || "";
      return `<button type="button" class="board-nav-chip" data-col="${c.dataset.colId}">${escaparHtml(nome)} <span>${n}</span></button>`;
    }).join("") : "";
    atualizar();
  };
  nav.addEventListener("click", (e) => {
    const b = e.target.closest(".board-nav-chip");
    if (!b) return;
    const col = cont.querySelector(`.column[data-col-id="${b.dataset.col}"]`);
    if (!col) return;
    cont.scrollTo({ left: col.offsetLeft - cont.offsetLeft - 8, behavior: "smooth" });
    col.classList.add("destaque-col");
    setTimeout(() => col.classList.remove("destaque-col"), 1300);
  });
  let pend = null;
  new MutationObserver(() => { clearTimeout(pend); pend = setTimeout(reconstruir, 60); }).observe(cont, { childList: true });
  reconstruir();

  // Roda do rato: com o rato sobre o cabeçalho/fundo (não sobre a lista de cartões) rola na horizontal
  cont.addEventListener("wheel", (e) => {
    if (e.target.closest(".cards-zone") && !e.shiftKey) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { cont.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });

  // Arrastar o fundo para "empurrar" o quadro (estilo mapa)
  let pan = null;
  cont.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".task-card, button, input, select, textarea, a, .column-head, .add-task-btn, [onclick]")) return;
    pan = { x: e.clientX, sl: cont.scrollLeft, id: e.pointerId, ativo: false };
  });
  cont.addEventListener("pointermove", (e) => {
    if (!pan) return;
    const dx = e.clientX - pan.x;
    // Só começa a "empurrar" depois de mexer uns píxeis, para o clique simples (ex.: "+ Nova coluna") continuar a funcionar
    if (!pan.ativo) {
      if (Math.abs(dx) < 5) return;
      pan.ativo = true;
      cont.classList.add("panning");
      cont.setPointerCapture?.(pan.id);
    }
    cont.scrollLeft = pan.sl - dx;
  });
  const fimPan = () => { pan = null; cont.classList.remove("panning"); };
  cont.addEventListener("pointerup", fimPan);
  cont.addEventListener("pointercancel", fimPan);

  // Ao arrastar uma tarefa para perto das bordas, o quadro desloca-se sozinho
  let auto = 0, rafAuto = null;
  const loop = () => { if (!auto) { rafAuto = null; return; } cont.scrollLeft += auto; rafAuto = requestAnimationFrame(loop); };
  const parar = () => { auto = 0; };
  cont.addEventListener("dragover", (e) => {
    const r = cont.getBoundingClientRect(), zona = 90;
    auto = e.clientX < r.left + zona ? -Math.ceil((r.left + zona - e.clientX) / 5) : e.clientX > r.right - zona ? Math.ceil((e.clientX - (r.right - zona)) / 5) : 0;
    if (auto && !rafAuto) rafAuto = requestAnimationFrame(loop);
  });
  ["dragend", "drop", "dragleave"].forEach((ev) => document.addEventListener(ev, (e) => { if (ev !== "dragleave" || !cont.contains(e.relatedTarget)) parar(); }));

  // Atalhos: Alt + ← / → saltam de coluna em coluna
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    if (document.getElementById("view-quadro")?.style.display === "none") return;
    cont.scrollBy({ left: e.key === "ArrowLeft" ? -310 : 310, behavior: "smooth" });
    e.preventDefault();
  });
}
