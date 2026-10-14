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
  // Poucas ligações: o plano gratuito do Supabase limita as ligações abertas
  // ao pooler, e esta aplicação é pequena.
  max: Number(process.env.PG_POOL_MAX) || 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
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
