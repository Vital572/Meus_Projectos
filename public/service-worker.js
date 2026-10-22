// Service worker do GPI Track — dá para instalar a aplicação (PWA) e permite
// reabrir páginas já visitadas sem ligação à internet (o "molde" da página:
// HTML/CSS/JS/imagens). Os dados em si (quadro, mensagens, notificações)
// continuam a precisar de ligação — isto só evita o ecrã em branco "sem
// internet" do navegador quando a pessoa volta a uma página já vista antes.

const CACHE_VERSAO = "gpitrack-v3";

// Núcleo da aplicação, guardado em cache logo na instalação.
const FICHEIROS_NUCLEO = [
  "/",
  "/entrar.html",
  "/projetos.html",
  "/board.html",
  "/workspace.html",
  "/css/styles.css",
  "/css/landing.css",
  "/js/api.js",
  "/js/ui-shell.js",
  "/js/lp-partials.js",
  "/js/tutoriais.js",
  "/img/unikivi-logo.png",
  "/img/icons/icon-192.png",
  "/img/icons/icon-512.png",
  "/manifest.json",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(CACHE_VERSAO).then((cache) => cache.addAll(FICHEIROS_NUCLEO)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches.keys().then((chaves) =>
      Promise.all(chaves.filter((c) => c !== CACHE_VERSAO).map((c) => caches.delete(c)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return; // só GET é seguro para cache

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return; // não mexe em pedidos a outros sites

  // A API, os ficheiros de utilizador (anexos/uploads) e o Socket.IO nunca
  // devem vir da cache — têm de ser sempre pedidos atuais à rede.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/") || url.pathname.startsWith("/uploads/")) {
    return;
  }

  // Páginas com "?token=" (ex.: ligação de recuperação de password) nunca são
  // guardadas em cache — o token ficaria gravado no dispositivo.
  if (url.searchParams.has("token")) return;

  // Para o resto (páginas, CSS, JS, imagens estáticas): tenta a rede primeiro
  // (para nunca mostrar uma versão desatualizada por engano) e, só se falhar
  // por falta de ligação, usa a última versão guardada em cache.
  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta && resposta.ok) {
          const copia = resposta.clone();
          caches.open(CACHE_VERSAO).then((cache) => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() => caches.match(pedido).then((resposta) => resposta || caches.match("/entrar.html")))
  );
});
