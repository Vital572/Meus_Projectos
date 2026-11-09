/**
 * Botão "Voltar" em (quase) todas as páginas — evita depender só do botão do navegador.
 * Usa o histórico quando a pessoa veio de outra página do site; senão vai para um destino lógico.
 */
(function () {
  const caminho = location.pathname.replace(/\/$/, "") || "/";
  // Sem "Voltar" na página inicial, em "Os meus projetos" (só se sai terminando a sessão) e nas
  // páginas principais do menu público (Funcionalidades, Projetos, Serviços, Sobre o projeto).
  const SEM_VOLTAR = ["/", "/index.html", "/projetos.html", "/funcionalidades.html", "/exemplos.html", "/servicos.html", "/sobre.html"];
  if (SEM_VOLTAR.includes(caminho)) return;
  const q = new URLSearchParams(location.search);
  const DESTINO = {
    "/board.html": "/projetos.html", "/workspace.html": q.get("voltar") ? `/board.html?projeto=${q.get("voltar")}` : "/projetos.html",
    "/admin.html": q.get("voltar") ? `/board.html?projeto=${q.get("voltar")}` : "/projetos.html",
    "/projetos.html": "/", "/exemplo.html": "/exemplos.html", "/servico.html": "/servicos.html", "/entrar.html": "/", "/esqueci-senha.html": "/entrar.html", "/redefinir-senha.html": "/entrar.html",
  };
  let temSessao = false;
  try { temSessao = !!sessionStorage.getItem("gpitrack_token"); } catch {}
  const fallback = DESTINO[caminho] || (temSessao ? "/projetos.html" : "/");

  function voltar() {
    let doMesmoSite = false;
    try { doMesmoSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
    if (doMesmoSite && history.length > 1) history.back(); else location.href = fallback;
  }

  function criar() {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn-voltar"; b.setAttribute("aria-label", "Voltar");
    b.innerHTML = '<span class="bv-seta">←</span><span class="bv-txt">Voltar</span>';
    b.addEventListener("click", voltar);
    return b;
  }

  function colocar() {
    if (document.querySelector(".btn-voltar")) return;
    const topbar = document.querySelector(".topbar > div:first-child");
    const hero = document.querySelector(".lp-page-hero");
    const cartao = document.querySelector(".auth-card");
    if (topbar) { const b = criar(); b.classList.add("bv-topbar"); const sb = topbar.querySelector(".btn-sidebar"); sb ? sb.after(b) : topbar.prepend(b); }
    else if (hero) { const b = criar(); b.classList.add("bv-hero"); hero.prepend(b); }
    else if (cartao) {
      // No login/registo/recuperação o botão fica por baixo do botão principal (Entrar, Criar conta, …)
      const b = criar(); b.classList.add("bv-auth");
      document.querySelectorAll(".auth-card form").forEach((f, i) => {
        const copia = i === 0 ? b : criar(); copia.classList.add("bv-auth");
        f.after(copia);
      });
      return;
    }
    else { const b = criar(); b.classList.add("bv-flutuante"); document.body.appendChild(b); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", colocar); else colocar();
})();
