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

  const backdrop = document.getElementById("sidebar-backdrop");
  if (backdrop) backdrop.addEventListener("click", () => shell.classList.remove("sidebar-aberta"));

  // Ao passar de telemóvel para o modo largo (ex.: rodar o ecrã), fecha o
  // painel deslizante para não ficar um estado estranho.
  window.addEventListener("resize", () => {
    if (!ecraPequeno()) shell.classList.remove("sidebar-aberta");
  });
}

iniciarUIShell();
