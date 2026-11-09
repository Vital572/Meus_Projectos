// Script partilhado por todas as páginas da aplicação (projetos, quadro,
// administração, espaço de gestão): alterna entre tema claro/escuro e
// esconde/mostra a barra lateral — com a preferência guardada no aparelho.

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);
  document.documentElement.setAttribute("data-bs-theme", tema === "claro" ? "light" : "dark");
  document.querySelectorAll(".btn-tema").forEach((btn) => (btn.textContent = tema === "claro" ? "🌙" : "☀️"));
}

function iniciarUIShell() {
  // ---------------- Tema claro/escuro ----------------
  aplicarTema(localStorage.getItem("gpitrack_tema") || document.documentElement.dataset.theme || "escuro");

  document.querySelectorAll(".btn-tema").forEach((btn) => {
    btn.addEventListener("click", () => {
      const atual = document.documentElement.dataset.theme === "claro" ? "claro" : "escuro";
      const novo = atual === "claro" ? "escuro" : "claro";
      aplicarTema(novo);
      localStorage.setItem("gpitrack_tema", novo);
    });
  });

  // ---------------- Esconder/mostrar a barra lateral ----------------
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const ecraPequeno = () => window.matchMedia("(max-width: 900px)").matches;

  // Em ecrãs largos respeita a preferência guardada; em ecrãs pequenos começa
  // sempre fechada (a barra lateral é um painel que desliza por cima do conteúdo).
  if (!ecraPequeno() && localStorage.getItem("gpitrack_sidebar") === "colapsada") {
    shell.classList.add("sidebar-colapsada");
  }

  document.querySelectorAll(".btn-sidebar").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (ecraPequeno()) {
        shell.classList.toggle("sidebar-aberta");
      } else {
        shell.classList.toggle("sidebar-colapsada");
        localStorage.setItem("gpitrack_sidebar", shell.classList.contains("sidebar-colapsada") ? "colapsada" : "aberta");
      }
    });
  });

  // ---------------- Arrastar a linha que separa os dois lados ----------------
  const LARG_PADRAO = 240, LARG_MIN = 200, LARG_MAX = 520;
  const barraLateral = shell.querySelector(".sidebar");
  if (barraLateral) {
    const limitar = (v) => Math.max(LARG_MIN, Math.min(LARG_MAX, Math.min(v, window.innerWidth - 360)));
    const aplicar = (v) => shell.style.setProperty("--sidebar-w", v + "px");
    let guardada = NaN;
    try { guardada = parseInt(localStorage.getItem("gpitrack_sidebar_largura"), 10); } catch {}
    if (guardada) aplicar(limitar(guardada));

    const alca = document.createElement("div");
    alca.className = "sidebar-resizer";
    alca.setAttribute("role", "separator");
    alca.setAttribute("aria-orientation", "vertical");
    alca.setAttribute("aria-label", "Redimensionar a barra lateral (setas para ajustar, duplo clique repõe)");
    alca.tabIndex = 0;
    alca.title = "Arraste para alterar a largura · duplo clique repõe";
    barraLateral.after(alca);

    const largAtual = () => Math.round(barraLateral.getBoundingClientRect().width);
    const guardar = (v) => { try { localStorage.setItem("gpitrack_sidebar_largura", String(v)); } catch {} };

    alca.addEventListener("pointerdown", (e) => {
      if (ecraPequeno()) return;
      e.preventDefault();
      alca.setPointerCapture(e.pointerId);
      alca.classList.add("a-arrastar");
      document.body.classList.add("a-redimensionar");
      const x0 = e.clientX, w0 = largAtual();
      const mover = (ev) => aplicar(limitar(w0 + ev.clientX - x0));
      const parar = () => {
        alca.removeEventListener("pointermove", mover);
        alca.removeEventListener("pointerup", parar);
        alca.removeEventListener("pointercancel", parar);
        alca.classList.remove("a-arrastar");
        document.body.classList.remove("a-redimensionar");
        guardar(largAtual());
      };
      alca.addEventListener("pointermove", mover);
      alca.addEventListener("pointerup", parar);
      alca.addEventListener("pointercancel", parar);
    });
    alca.addEventListener("dblclick", () => {
      shell.style.removeProperty("--sidebar-w");
      try { localStorage.removeItem("gpitrack_sidebar_largura"); } catch {}
    });
    alca.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home") return;
      e.preventDefault();
      if (e.key === "Home") { alca.dispatchEvent(new Event("dblclick")); return; }
      const v = limitar(largAtual() + (e.key === "ArrowRight" ? 16 : -16));
      aplicar(v); guardar(v);
    });
  }

  const backdrop = document.getElementById("sidebar-backdrop");
  if (backdrop) backdrop.addEventListener("click", () => shell.classList.remove("sidebar-aberta"));

  // No telemóvel, escolher uma opção do menu lateral fecha o menu (para a
  // pessoa ver logo o conteúdo escolhido). Controlos que só mexem no próprio
  // menu (seletor de projeto, caixas de seleção dos membros) deixam-no aberto.
  const barra = document.querySelector(".sidebar");
  if (barra) {
    barra.addEventListener("click", (e) => {
      if (!ecraPequeno() || !shell.classList.contains("sidebar-aberta")) return;
      const alvo = e.target;
      if (alvo.closest("#ps-atual, #lista-membros, input, select, textarea, label, .project-switcher-lista, .btn-sidebar")) return;
      if (!alvo.closest(".admin-nav-item, #link-voltar, .add-task-btn, a[href], [onclick], .project-switcher-item, .new-project-card")) return;
      setTimeout(() => shell.classList.remove("sidebar-aberta"), 120); // deixa a opção executar primeiro
    });
  }

  // Ao passar de telemóvel para o modo largo (ex.: rodar o ecrã), fecha o
  // painel deslizante para não ficar um estado estranho.
  window.addEventListener("resize", () => {
    if (!ecraPequeno()) shell.classList.remove("sidebar-aberta");
  });
}

iniciarUIShell();

// ---------------- PWA: instalar e funcionar offline ----------------
// Regista o service worker (molde da app guardado em cache) para que as
// páginas já visitadas abram mesmo sem ligação à internet.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

// ---------------- Janelas (overlays): ESC e clique no fundo fecham ----------------
// Usa sempre o botão × da própria janela, para que cada janela execute a sua
// rotina de fecho (limpar formulários, etc.). O fundo só fecha se o clique
// COMEÇOU e terminou nele (não fecha ao largar a seleção de texto fora).
(function ligarFechoDeJanelas() {
  let pressionadoNoFundo = false;
  document.addEventListener("mousedown", (e) => { pressionadoNoFundo = e.target.classList?.contains("overlay") && e.target.classList.contains("open"); });
  document.addEventListener("click", (e) => {
    if (!pressionadoNoFundo || !e.target.classList?.contains("overlay")) return;
    pressionadoNoFundo = false;
    e.target.querySelector(".modal-close")?.click();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const abertas = [...document.querySelectorAll(".overlay.open")];
    abertas[abertas.length - 1]?.querySelector(".modal-close")?.click();
  });
})();

// ---------------- Animações ----------------
// Entrada em cascata dos cartões/colunas: chamar depois de desenhar os dados.
const SELETORES_ENTRADA = ".hero-strip, .kpi-tile, .stat-card, .resumo-quadro > *, .project-card, .pc2, .column, .task-card, .report-card, .member-row";
function animarEntrada() {
  document.querySelectorAll(SELETORES_ENTRADA).forEach((el, i) => el.style.setProperty("--ai", Math.min(i, 18)));
  document.body.classList.remove("entrando");
  void document.body.offsetWidth; // reinicia as animações
  document.body.classList.add("entrando");
  clearTimeout(animarEntrada._t);
  animarEntrada._t = setTimeout(() => document.body.classList.remove("entrando"), 2200);
}
window.animarEntrada = animarEntrada;

// Ondulação ao clicar em botões
document.addEventListener("pointerdown", (e) => {
  const alvo = e.target.closest?.(".btn, .mini-btn, .grupo-chip, .view-tab");
  if (!alvo || alvo.disabled) return;
  const r = alvo.getBoundingClientRect();
  const d = Math.max(r.width, r.height);
  const onda = document.createElement("span");
  onda.className = "ripple";
  onda.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  alvo.appendChild(onda);
  setTimeout(() => onda.remove(), 650);
});

// Contadores que "sobem" quando o número muda (KPIs, resumo do quadro, estatísticas)
(function contadoresAnimados() {
  const SEL = ".kpi-num, .stat-card .num, [id^='rq-'], .pc2 .pc-num";
  const emCurso = new WeakSet();
  function animar(el) {
    if (emCurso.has(el)) return;
    const texto = el.textContent.trim();
    const m = texto.match(/^(\d+)(%?)$/);
    if (!m) return;
    const alvo = Number(m[1]), sufixo = m[2];
    const de = Number(el.dataset.valorAnterior ?? 0);
    el.dataset.valorAnterior = alvo;
    if (de === alvo) return;
    emCurso.add(el);
    const t0 = performance.now(), dur = 900;
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(de + (alvo - de) * ease) + sufixo;
      if (p < 1) requestAnimationFrame(passo);
      else { el.textContent = alvo + sufixo; emCurso.delete(el); el.classList.remove("num-pulso"); void el.offsetWidth; el.classList.add("num-pulso"); }
    };
    requestAnimationFrame(passo);
  }
  const obs = new MutationObserver((muts) => {
    for (const mu of muts) {
      const el = (mu.target.nodeType === 3 ? mu.target.parentElement : mu.target)?.closest?.(SEL);
      if (el && !emCurso.has(el)) animar(el);
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(SEL).forEach((el) => obs.observe(el, { childList: true, characterData: true, subtree: true }));
    // elementos criados mais tarde
    new MutationObserver(() => document.querySelectorAll(SEL).forEach((el) => { if (!el._obs) { el._obs = true; obs.observe(el, { childList: true, characterData: true, subtree: true }); } })).observe(document.body, { childList: true, subtree: true });
  });
})();

// ---------------- Janelas de diálogo da plataforma (substituem alert/confirm/prompt do navegador) ----------------
// gpiConfirm("Texto") -> Promise<boolean>;  gpiConfirm({titulo, texto, confirmar, perigo})
// gpiPrompt({titulo, texto, rotulo, placeholder, valor, cores, corInicial}) -> Promise<string|{valor,cor}|null>
function gpiDialogo(op) {
  return new Promise((resolve) => {
    const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const ov = document.createElement("div");
    ov.className = "overlay gpi-dialogo";
    ov.style.zIndex = 400;
    const ico = op.icone || (op.perigo ? "⚠️" : op.campo ? "✏️" : "❓");
    ov.innerHTML = `
      <div class="gpi-modal" role="dialog" aria-modal="true" style="max-width:${op.campo ? 440 : 400}px">
        <span class="modal-close" title="Cancelar">&times;</span>
        <div class="gpi-dialogo-ico ${op.perigo ? "perigo" : ""}">${ico}</div>
        <h3 style="padding-right:0">${esc(op.titulo || "Confirmar")}</h3>
        ${op.texto ? `<p class="sub" style="margin:0 0 16px;line-height:1.5">${esc(op.texto)}</p>` : ""}
        ${op.campo ? `<div class="field"><label>${esc(op.campo.rotulo || "")}</label><input type="text" class="gpi-dialogo-input" maxlength="${op.campo.maxlength || 80}" placeholder="${esc(op.campo.placeholder || "")}" value="${esc(op.campo.valor || "")}" autocomplete="off" /></div>` : ""}
        ${op.cores ? `<div class="field"><label>Cor</label><div class="gpi-cores">${op.cores.map((c) => `<button type="button" class="gpi-cor ${c === op.corInicial ? "ativa" : ""}" data-cor="${esc(c)}" style="background:${esc(c)}" aria-label="Cor ${esc(c)}"></button>`).join("")}</div>
          <div class="gpi-previa">Pré-visualização: <span class="gpi-previa-chip" style="--c:${esc(op.corInicial || op.cores[0])}">${esc(op.campo?.valor || "Etiqueta")}</span></div></div>` : ""}
        <div class="gpi-dialogo-botoes">
          <button type="button" class="btn btn-ghost gpi-cancelar">${esc(op.cancelar || "Cancelar")}</button>
          <button type="button" class="btn ${op.perigo ? "btn-perigo" : "btn-primary"} gpi-ok">${esc(op.confirmar || "Confirmar")}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const input = ov.querySelector(".gpi-dialogo-input");
    let cor = op.corInicial || op.cores?.[0];
    const previa = ov.querySelector(".gpi-previa-chip");
    ov.querySelectorAll(".gpi-cor").forEach((b) => b.addEventListener("click", () => {
      ov.querySelectorAll(".gpi-cor").forEach((x) => x.classList.remove("ativa"));
      b.classList.add("ativa"); cor = b.dataset.cor; previa?.style.setProperty("--c", cor);
    }));
    input?.addEventListener("input", () => { if (previa) previa.textContent = input.value.trim() || "Etiqueta"; input.classList.remove("invalido"); });
    let fechado = false;
    const fechar = (valor) => {
      if (fechado) return; fechado = true;
      ov.classList.remove("open");
      document.removeEventListener("keydown", tecla, true);
      setTimeout(() => ov.remove(), 450);
      resolve(valor);
    };
    const ok = () => {
      if (op.campo) {
        const v = input.value.trim();
        if (!v) { input.classList.add("invalido"); input.focus(); return; }
        return fechar(op.cores ? { valor: v, cor } : v);
      }
      fechar(true);
    };
    const cancelar = () => fechar(op.campo ? null : false);
    ov.querySelector(".gpi-ok").addEventListener("click", ok);
    ov.querySelector(".gpi-cancelar").addEventListener("click", cancelar);
    ov.querySelector(".modal-close").addEventListener("click", cancelar);
    const tecla = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); ok(); }
    };
    document.addEventListener("keydown", tecla, true);
    requestAnimationFrame(() => { ov.classList.add("open"); setTimeout(() => (input || ov.querySelector(".gpi-ok")).focus(), 120); if (input) input.select(); });
  });
}
function gpiConfirm(arg) {
  const op = typeof arg === "string" ? { texto: arg } : arg;
  const t = (op.texto || "").toLowerCase();
  const perigo = op.perigo ?? /eliminar|apagar|sair|desativar|cancelar esta/.test(t);
  return gpiDialogo({ titulo: op.titulo || (perigo ? "Tem a certeza?" : "Confirmar"), confirmar: op.confirmar || (/eliminar/.test(t) ? "Eliminar" : /sair/.test(t) ? "Sair" : /desativar/.test(t) ? "Desativar" : /cancelar esta/.test(t) ? "Cancelar reunião" : "Confirmar"), cancelar: /cancelar esta/.test(t) ? "Voltar" : undefined, ...op, perigo });
}
function gpiPrompt(op) { return gpiDialogo(op); }
function gpiAviso(texto, titulo = "Aviso") { return gpiDialogo({ titulo, texto, icone: "ℹ️", confirmar: "OK", cancelar: "Fechar" }).then(() => {}); }
window.gpiConfirm = gpiConfirm; window.gpiPrompt = gpiPrompt; window.gpiAviso = gpiAviso;
