const { Pool } = require("pg");
require("dotenv").config();

// Ligação à base de dados PostgreSQL, schema "gpitrack".
// Ajuste as variáveis no ficheiro .env (ver .env.example).
//
// O SSL liga-se sozinho sempre que PGHOST não for "localhost"/"127.0.0.1" —
// é isso que a maioria dos serviços de PostgreSQL na nuvem (Supabase, Neon,
// etc.) exige. Em desenvolvimento local não muda nada.
const ehLocal = !process.env.PGHOST || ["localhost", "127.0.0.1"].includes(process.env.PGHOST);

const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "gpitrack",
  ssl: ehLocal ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Erro inesperado na pool do PostgreSQL:", err);
});

module.exports = pool;
