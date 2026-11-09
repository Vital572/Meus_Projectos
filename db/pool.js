const { Pool } = require("pg");
require("dotenv").config();

// Ligação à base de dados PostgreSQL (schema "gpitrack").
//
// Duas formas de configurar (a primeira tem prioridade):
//   1) DATABASE_URL — uma única linha. É o que se usa no Render + Supabase
//      (copiar a "Session pooler" do Supabase, ver DEPLOY.md).
//   2) PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE — para o PostgreSQL
//      local (pgAdmin), como sempre.
//
// O SSL liga-se sozinho sempre que o servidor NÃO for local, porque é isso
// que o Supabase (e a maioria dos serviços na nuvem) exige.
const url = process.env.DATABASE_URL ? process.env.DATABASE_URL.trim() : null;

function hostDaUrl(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
}

const host = url ? hostDaUrl(url) : process.env.PGHOST || "localhost";
const ehLocal = !host || ["localhost", "127.0.0.1", "::1"].includes(host);

const opcoes = {
  // Nº máximo de ligações em simultâneo. No Supabase (Session pooler, plano grátis)
  // há um limite baixo de ligações — se precisar, ajuste PGPOOL_MAX.
  max: Number(process.env.PGPOOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  // Se o pool estiver esgotado, falha ao fim de 15 s com um erro claro em vez de
  // deixar o pedido pendurado para sempre.
  connectionTimeoutMillis: Number(process.env.PGPOOL_TIMEOUT_MS) || 15000,
  keepAlive: true,
  ssl: ehLocal ? false : { rejectUnauthorized: false },
};

if (url) {
  // O pg dá prioridade ao "sslmode" que vier dentro do URL e ignoraria a opção
  // "ssl" acima; por isso retira-se do URL e o SSL fica sempre controlado aqui.
  opcoes.connectionString = url.replace(/([?&])sslmode=[^&]*&?/i, "$1").replace(/[?&]$/, "");
} else {
  opcoes.host = process.env.PGHOST || "localhost";
  opcoes.port = process.env.PGPORT || 5432;
  opcoes.user = process.env.PGUSER || "postgres";
  opcoes.password = process.env.PGPASSWORD || "postgres";
  opcoes.database = process.env.PGDATABASE || "gpitrack";
}

const pool = new Pool(opcoes);

pool.on("error", (err) => {
  console.error("Erro inesperado na pool do PostgreSQL:", err.message);
});

pool.ehLocal = ehLocal; // usado pelo seed para não apagar uma base de dados remota por engano
module.exports = pool;
