// Cabeçalho e rodapé partilhados pelas páginas públicas do GPI Track
// (index, funcionalidades, exemplos, serviços, sobre). Cada página só
// precisa de um <div id="lp-header"></div> / <div id="lp-footer"></div>
// e de chamar renderizarCabecalhoRodapeLP("<id-da-pagina>").

const LP_NAV_ITENS = [
  { href: "/funcionalidades.html", label: "Funcionalidades", id: "funcionalidades" },
  { href: "/exemplos.html", label: "Projetos", id: "projetos" },
  { href: "/servicos.html", label: "Serviços", id: "servicos" },
  { href: "/sobre.html", label: "Sobre o projeto", id: "sobre" },
];

function renderizarCabecalhoRodapeLP(paginaAtual) {
  const header = document.getElementById("lp-header");
  if (header) {
    header.innerHTML = `
      <a href="/" class="lp-brand">
        <img src="/img/unikivi-logo.png" alt="Universidade Kimpa Vita" />
        <div class="lp-brand-text">
          <b>GPI Track</b>
          <span>Instituto Politécnico · Unikivi</span>
        </div>
      </a>
      <nav class="lp-nav" id="lp-nav-collapse">
        ${LP_NAV_ITENS.map((i) => `<a href="${i.href}" class="${i.id === paginaAtual ? "lp-nav-ativo" : ""}">${i.label}</a>`).join("")}
        <div class="lp-nav-actions lp-nav-actions-mobile">
          <a href="/entrar.html" class="btn" style="background:transparent;border:1px solid var(--border);color:var(--ink)">Entrar</a>
          <a href="/entrar.html?criar=1" class="btn btn-primary">Criar conta grátis</a>
        </div>
      </nav>
      <div class="lp-nav-actions">
        <a href="/entrar.html" class="btn" style="background:transparent;border:1px solid var(--border);color:var(--ink)">Entrar</a>
        <a href="/entrar.html?criar=1" class="btn btn-primary">Criar conta grátis</a>
      </div>
      <button class="lp-nav-toggle" type="button" id="lp-nav-toggle-btn" aria-controls="lp-nav-collapse" aria-expanded="false" aria-label="Abrir menu">
        <i class="bi bi-list"></i>
      </button>
    `;

    const navToggleBtn = document.getElementById("lp-nav-toggle-btn");
    const nav = document.getElementById("lp-nav-collapse");
    navToggleBtn.addEventListener("click", () => {
      const aberto = nav.classList.toggle("lp-nav-open");
      navToggleBtn.setAttribute("aria-expanded", aberto ? "true" : "false");
      navToggleBtn.innerHTML = aberto ? '<i class="bi bi-x-lg"></i>' : '<i class="bi bi-list"></i>';
    });
  }

  const footer = document.getElementById("lp-footer");
  if (footer) {
    footer.innerHTML = `
      <div class="lp-footer-grid">
        <div>
          <div class="lp-footer-brand">
            <img src="/img/unikivi-logo.png" alt="Unikivi" />
            <b>GPI Track</b>
          </div>
          <p class="desc">Protótipo académico de gestão de projetos colaborativa, desenvolvido no
          Instituto Politécnico da Universidade Kimpa Vita — Uíge, Angola.</p>
        </div>
        <div>
          <h4>Produto</h4>
          <ul>
            <li><a href="/funcionalidades.html">Funcionalidades</a></li>
            <li><a href="/exemplos.html">Exemplos de projetos</a></li>
            <li><a href="/servicos.html">Serviços</a></li>
          </ul>
        </div>
        <div>
          <h4>Conta</h4>
          <ul>
            <li><a href="/entrar.html">Entrar</a></li>
            <li><a href="/entrar.html?criar=1">Criar conta</a></li>
          </ul>
        </div>
        <div>
          <h4>Instituição</h4>
          <ul>
            <li><a href="/sobre.html">Sobre o projeto</a></li>
            <li><a href="/sobre.html">Instituto Politécnico · Unikivi</a></li>
            <li><a href="/#feedback">Deixar feedback</a></li>
          </ul>
        </div>
      </div>
      <div class="lp-footer-bottom">
        <span>© 2026 GPI Track · Universidade Kimpa Vita. Protótipo académico, sem fins comerciais.</span>
        <span>Desenvolvido por Sílivia Figueiredo &amp; Vital Manuel</span>
      </div>
    `;
  }
}

function ativarRevealOnScrollLP() {
  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add("lp-revelado");
        observador.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".lp-section, .lp-cta, .lp-hero, .lp-page-hero").forEach((el) => {
    el.classList.add("lp-por-revelar");
    observador.observe(el);
  });
}
