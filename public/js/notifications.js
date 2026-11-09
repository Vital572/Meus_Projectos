const rotulosNotificacao = {
  "task.assigned": "📌",
  "comment.new": "💬",
  "mention": "📣",
  "project.invited": "👥",
  "project.invite": "✉️",
  "project.invite_approval_request": "🙋",
  "project.invite_approved": "✅",
  "project.invite_rejected": "❌",
  "project.invite_accepted": "🎉",
  "project.invite_declined": "🚫",
  "project.left": "🚪",
  "channel.group": "👥",
  "admin.announcement": "📢",
  "task.file_sent": "📎",
  "meeting.scheduled": "🗓️",
  "meeting.cancelled": "🚫",
  "project.made_responsible": "👑",
  "automation.triggered": "⚡",
  "task.due_tomorrow": "⏰",
  "task.due_today": "🚨",
  "task.made_responsible": "👑",
};

function montarSino() {
  const wrap = document.createElement("div");
  wrap.style.position = "relative";
  wrap.innerHTML = `
    <div id="botao-sino" style="cursor:pointer;position:relative;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:var(--navy-900);border:1px solid var(--border)">
      🔔
      <span id="badge-sino" style="display:none;position:absolute;top:-5px;right:-5px;background:var(--danger);color:#fff;font-size:10px;font-weight:700;border-radius:20px;padding:1px 5px;min-width:16px;text-align:center">0</span>
    </div>
    <div id="painel-notificacoes" style="display:none;position:absolute;top:42px;right:0;width:min(380px,calc(100vw - 24px));max-height:70vh;overflow-y:auto;background:var(--navy-800);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);z-index:60;padding:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px 10px">
        <strong style="font-size:13px">Notificações</strong>
        <span style="display:flex;align-items:center;gap:10px"><span style="font-size:11.5px;color:var(--cyan);cursor:pointer" id="marcar-todas-lidas">Marcar todas como lidas</span>
        <span class="notif-fechar" id="notif-fechar" title="Fechar">✕</span></span>
      </div>
      <div id="lista-notificacoes"></div>
    </div>
  `;
  return wrap;
}

// ---------------- Convites dentro das notificações ----------------
// Os convites recebidos e os pedidos de convite para aprovar aparecem no topo
// do painel, com os botões Aceitar/Rejeitar (ou Aprovar/Rejeitar) e "Ver convite".
let convitesRecebidos = [];
let convitesParaAprovar = [];
let notificacoesNaoLidas = 0;
const TIPOS_CONVITE = ["project.invite", "project.invite_approval_request"];
const escN = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function totalConvitesPendentes() { return convitesRecebidos.length + convitesParaAprovar.length; }
function atualizarBadgeGeral() { atualizarBadge(notificacoesNaoLidas + totalConvitesPendentes()); }

async function carregarNotificacoes() {
  const [notificacoes, recebidos, aprovar] = await Promise.all([
    api.get("/api/notifications"),
    api.get("/api/projects/convites/meus").catch(() => []),
    api.get("/api/projects/convites/para-aprovar").catch(() => []),
  ]);
  convitesRecebidos = recebidos;
  convitesParaAprovar = aprovar;
  // As notificações de convite são substituídas pelos cartões com botões
  const normais = notificacoes.filter((n) => !TIPOS_CONVITE.includes(n.type));
  notificacoesNaoLidas = normais.filter((n) => !n.is_read).length;
  renderizarNotificacoes(normais);
  atualizarBadgeGeral();
}

const GRUPOS_CONVITE = {
  r: {
    icone: "✉️", titulo: "Convites recebidos", sim: "Aceitar", nao: "Rejeitar",
    lista: () => convitesRecebidos,
    linhaTitulo: (c) => `Convite para "${escN(c.projeto_nome)}"`,
    linhaSub: (c) => `Convidado(a) por ${escN(c.convidado_por || "—")}`,
    acao: (c, sim) => api.post(`/api/projects/${c.projeto_id}/convite/${sim ? "aceitar" : "recusar"}`),
    msg: (n, sim) => sim ? (n === 1 ? "Convite aceite! Já faz parte do projeto." : `${n} convites aceites.`) : (n === 1 ? "Convite rejeitado." : `${n} convites rejeitados.`),
  },
  a: {
    icone: "🙋", titulo: "Pedidos para aprovar", sim: "Aprovar", nao: "Rejeitar",
    lista: () => convitesParaAprovar,
    linhaTitulo: (c) => `${escN(c.utilizador_nome)} → "${escN(c.projeto_nome)}"`,
    linhaSub: (c) => `Proposto por ${escN(c.proposto_por || "—")}`,
    acao: (c, sim) => api.post(`/api/projects/${c.projeto_id}/membros/${c.utilizador_id}/aprovar-convite`, { aprovar: sim }),
    msg: (n, sim) => sim ? (n === 1 ? "Convite aprovado e enviado." : `${n} convites aprovados.`) : (n === 1 ? "Pedido rejeitado." : `${n} pedidos rejeitados.`),
  },
};

function htmlGrupoConvites(k) {
  const g = GRUPOS_CONVITE[k];
  const itens = g.lista();
  if (!itens.length) return "";
  return `
    <div class="nc-grupo" data-k="${k}">
      <div class="nc-grupo-titulo">${g.icone} ${g.titulo} <span class="badge-contagem">${itens.length}</span></div>
      ${itens.length > 1 ? `
        <div class="nc-lote">
          <label><input type="checkbox" class="nc-todos" /> Selecionar todos</label>
          <span class="nc-lote-acoes">
            <button type="button" class="btn-nc ok nc-lote-sim" disabled>${g.sim}</button>
            <button type="button" class="btn-nc no nc-lote-nao" disabled>${g.nao}</button>
          </span>
        </div>` : ""}
      ${itens.map((c, n) => `
        <div class="nc-cartao" data-n="${n}">
          <input type="checkbox" class="nc-cb" aria-label="Selecionar" />
          <div class="nc-corpo">
            <div class="nc-t">${g.linhaTitulo(c)}</div>
            <div class="nc-s">${g.linhaSub(c)}</div>
            <div class="nc-acoes">
              <button type="button" class="btn-nc ok nc-sim">${g.sim}</button>
              <button type="button" class="btn-nc no nc-nao">${g.nao}</button>
              <button type="button" class="btn-nc ver nc-ver">Ver convite</button>
            </div>
          </div>
        </div>`).join("")}
    </div>`;
}

async function executarConvites(k, itens, sim) {
  const g = GRUPOS_CONVITE[k];
  document.querySelectorAll("#lista-notificacoes .nc-grupo button").forEach((b) => (b.disabled = true));
  let feitos = 0; const falhas = [];
  for (const c of itens) {
    try { await g.acao(c, sim); feitos++; } catch (err) { falhas.push(err.message); }
  }
  if (feitos) mostrarToast(g.msg(feitos, sim));
  if (falhas.length) mostrarToast(falhas[0]);
  await carregarNotificacoes();
  window.dispatchEvent(new CustomEvent("convites:alterados"));
}

function ligarGruposConvites(container) {
  container.querySelectorAll(".nc-grupo").forEach((grupo) => {
    const k = grupo.dataset.k;
    const itens = GRUPOS_CONVITE[k].lista();
    const cbs = [...grupo.querySelectorAll(".nc-cb")];
    const todos = grupo.querySelector(".nc-todos");
    const marcados = () => cbs.map((cb, n) => (cb.checked ? itens[n] : null)).filter(Boolean);
    const atualizar = () => {
      const m = marcados().length;
      cbs.forEach((cb) => cb.closest(".nc-cartao").classList.toggle("sel", cb.checked));
      if (todos) {
        todos.checked = m === cbs.length; todos.indeterminate = m > 0 && m < cbs.length;
        grupo.querySelector(".nc-lote-sim").disabled = grupo.querySelector(".nc-lote-nao").disabled = m === 0;
      }
    };
    cbs.forEach((cb) => cb.addEventListener("change", atualizar));
    todos?.addEventListener("change", () => { cbs.forEach((cb) => (cb.checked = todos.checked)); atualizar(); });
    grupo.querySelector(".nc-lote-sim")?.addEventListener("click", () => executarConvites(k, marcados(), true));
    grupo.querySelector(".nc-lote-nao")?.addEventListener("click", () => executarConvites(k, marcados(), false));
    grupo.querySelectorAll(".nc-cartao").forEach((cartao) => {
      const c = itens[Number(cartao.dataset.n)];
      cartao.querySelector(".nc-sim").addEventListener("click", () => executarConvites(k, [c], true));
      cartao.querySelector(".nc-nao").addEventListener("click", () => executarConvites(k, [c], false));
      cartao.querySelector(".nc-ver").addEventListener("click", () => verConvite(k, c));
    });
  });
}

function verConvite(k, c) {
  const g = GRUPOS_CONVITE[k];
  document.getElementById("overlay-ver-convite")?.remove();
  const linhas = k === "r"
    ? [["Projeto", c.projeto_nome], ["Descrição", c.descricao || "Sem descrição."], ["Equipa", c.equipa_nome || "—"],
       ["Membros", c.total_membros], ["Tarefas", c.total_tarefas], ["Convidado(a) por", c.convidado_por || "—"]]
    : [["Pessoa proposta", c.utilizador_nome], ["Email", c.utilizador_email], ["Projeto", c.projeto_nome], ["Proposta por", c.proposto_por || "—"]];
  const ov = document.createElement("div");
  ov.className = "overlay open"; ov.id = "overlay-ver-convite";
  ov.innerHTML = `
    <div class="gpi-modal" style="position:relative;max-width:460px">
      <span class="modal-close" id="vc-fechar">&times;</span>
      <h3>${g.icone} ${k === "r" ? "Convite para um projeto" : "Pedido de convite"}</h3>
      <div class="nc-detalhe">${linhas.map(([a, b]) => `<div><span>${a}</span><b>${escN(b)}</b></div>`).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="vc-sim" style="width:auto">${g.sim}</button>
        <button type="button" class="btn btn-ghost" id="vc-nao" style="width:auto">${g.nao}</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  const fechar = () => ov.remove();
  ov.addEventListener("click", (e) => { if (e.target === ov) fechar(); });
  ov.querySelector("#vc-fechar").addEventListener("click", fechar);
  ov.querySelector("#vc-sim").addEventListener("click", () => { fechar(); executarConvites(k, [c], true); });
  ov.querySelector("#vc-nao").addEventListener("click", () => { fechar(); executarConvites(k, [c], false); });
}

function renderizarNotificacoes(lista) {
  const container = document.getElementById("lista-notificacoes");
  if (!container) return;
  const convitesHtml = htmlGrupoConvites("r") + htmlGrupoConvites("a");
  if (lista.length === 0 && !convitesHtml) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--ink-faint);font-size:13px">Sem notificações por agora.</div>`;
    return;
  }
  container.innerHTML = convitesHtml + (lista.length ? lista.map((n) => `
    <div class="notif-item" data-id="${n.id}" data-type="${n.type}" data-project-id="${n.project_id || ""}" data-task-id="${n.task_id || ""}"
         style="display:flex;gap:10px;padding:10px 8px;border-radius:8px;cursor:pointer;${n.is_read ? "" : "background:rgba(34,199,221,0.06)"}">
      <div style="font-size:16px">${rotulosNotificacao[n.type] || "🔔"}</div>
      <div style="flex:1">
        <div style="font-size:12.5px;line-height:1.4">${n.content}</div>
        <div style="font-size:10.5px;color:var(--ink-faint);margin-top:3px">${new Date(n.created_at).toLocaleString("pt-PT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      </div>
      ${n.project_id ? `<div style="font-size:14px;color:var(--ink-faint);align-self:center">→</div>` : ""}
    </div>
  `).join("") : "");
  ligarGruposConvites(container);

  container.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", async () => {
      await api.patch(`/api/notifications/${el.dataset.id}/lida`, {});

      // Leva ao sítio exato relacionado com a notificação: a tarefa (se houver),
      // a janela de reuniões do projeto (se for sobre uma reunião; o Espaço de Gestão é só para responsáveis),
      // senão o quadro do projeto — em vez de só marcar como lida e ficar parado.
      const tipo = el.dataset.type;
      const projetoId = el.dataset.projectId;
      const tarefaId = el.dataset.taskId;
      if (projetoId) {
        let destino;
        if (tipo === "meeting.scheduled" || tipo === "meeting.cancelled") {
          destino = `/board.html?projeto=${projetoId}&reunioes=1`;
        } else if (tarefaId) {
          destino = `/board.html?projeto=${projetoId}&tarefa=${tarefaId}`;
        } else {
          destino = `/board.html?projeto=${projetoId}`;
        }
        window.location.href = destino;
        return;
      }

      el.style.background = "transparent";
      notificacoesNaoLidas = document.querySelectorAll("#lista-notificacoes .notif-item[style*='rgba(34']").length;
      atualizarBadgeGeral();
    });
  });
}

function atualizarBadge(n) {
  const badge = document.getElementById("badge-sino");
  if (!badge) return;
  badge.textContent = n > 9 ? "9+" : n;
  badge.style.display = n > 0 ? "block" : "none";
}

function iniciarNotificacoes(socket) {
  const sinoContainer = document.getElementById("ancora-sino");
  if (sinoContainer) sinoContainer.appendChild(montarSino());

  document.getElementById("notif-fechar")?.addEventListener("click", (e) => { e.stopPropagation(); document.getElementById("painel-notificacoes").style.display = "none"; });
  document.getElementById("botao-sino")?.addEventListener("click", () => {
    const painel = document.getElementById("painel-notificacoes");
    painel.style.display = painel.style.display === "none" ? "block" : "none";
    if (painel.style.display === "block") carregarNotificacoes().catch(() => {}); // convites sempre atualizados
  });

  document.getElementById("marcar-todas-lidas")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await api.patch("/api/notifications/lidas", {});
    document.querySelectorAll(".notif-item").forEach((el) => (el.style.background = "transparent"));
    notificacoesNaoLidas = 0;
    atualizarBadgeGeral(); // os convites pendentes continuam a contar até serem respondidos
  });

  document.addEventListener("click", (e) => {
    const painel = document.getElementById("painel-notificacoes");
    const sino = document.getElementById("botao-sino");
    if (painel && !painel.contains(e.target) && e.target !== sino && !sino?.contains(e.target)) {
      painel.style.display = "none";
    }
  });

  carregarNotificacoes();

  socket.on("notification:new", (n) => {
    mostrarToast(n.content);
    const sinoEl = document.getElementById("botao-sino");
    if (sinoEl) { sinoEl.classList.remove("toca"); void sinoEl.offsetWidth; sinoEl.classList.add("toca"); }
    const lista = document.getElementById("lista-notificacoes");
    if (lista) carregarNotificacoes();
  });

  // Se um administrador desativar/eliminar a conta, a sessão é terminada de imediato
  socket.on("conta:desativada", ({ motivo }) => {
    const sair = () => api.post("/api/auth/logout").finally(() => (window.location.href = "/entrar.html"));
    if (window.gpiAviso) gpiAviso(motivo || "A sua conta foi desativada.", "Sessão terminada").then(sair); else sair();
  });
}
