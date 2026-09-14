/**
 * Popula a base de dados com dados de demonstração:
 * 1 equipa, 3 utilizadores, 1 projeto, 4 colunas Kanban e várias tarefas.
 *
 * Uso: npm run seed
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("./pool");

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("SET search_path TO gpitrack");
    await client.query("BEGIN");

    console.log("A limpar dados existentes...");
    await client.query(`
      TRUNCATE activity_log, notifications, comments, checklist_items, task_labels,
               labels, tasks, board_columns, project_members, projects,
               team_members, teams, users
      CASCADE
    `);

    console.log("A criar utilizadores...");
    const senha = await bcrypt.hash("123456", 10);
    const users = [
      { name: "Vital Manuel", email: "vital@ukv.ao", color: "#0EA5B7", role: "admin" },
      { name: "Ana Kiala", email: "ana@ukv.ao", color: "#E67E22", role: "member" },
      { name: "Domingos Sabata", email: "domingos@ukv.ao", color: "#8E44AD", role: "member" },
    ];
    const userIds = [];
    for (const u of users) {
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, avatar_color, role, is_active)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [u.name, u.email, senha, u.color, u.role]
      );
      userIds.push(rows[0].id);
    }
    console.log(`   Utilizadores criados. Password de todos: "123456" (${users[0].email} é administrador)`);

    console.log("A criar equipa...");
    const { rows: teamRows } = await client.query(
      `INSERT INTO teams (name, created_by) VALUES ($1, $2) RETURNING id`,
      ["Equipa GPI — UKV", userIds[0]]
    );
    const teamId = teamRows[0].id;

    for (let i = 0; i < userIds.length; i++) {
      await client.query(
        `INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)`,
        [teamId, userIds[i], i === 0 ? "admin" : "member"]
      );
    }

    console.log("A criar projeto...");
    const { rows: projRows } = await client.query(
      `INSERT INTO projects (team_id, name, description, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        teamId,
        "CurriculumIA — Plataforma de CV Académico",
        "Acompanhamento em tempo real do desenvolvimento da plataforma CurriculumIA em regime de home office.",
        userIds[0],
      ]
    );
    const projectId = projRows[0].id;

    for (const uid of userIds) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)`,
        [projectId, uid, uid === userIds[0] ? "responsavel" : "membro"]
      );
    }

    console.log("A criar colunas do quadro Kanban...");
    const colunas = ["Por Fazer", "Em Curso", "Em Revisão", "Concluído"];
    const colIds = [];
    for (let i = 0; i < colunas.length; i++) {
      const { rows } = await client.query(
        `INSERT INTO board_columns (project_id, name, position, is_done)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [projectId, colunas[i], i, colunas[i] === "Concluído"]
      );
      colIds.push(rows[0].id);
    }

    console.log("A criar etiquetas de exemplo...");
    const etiquetasDef = [
      { name: "Urgente", color: "#EF6461" },
      { name: "Backend", color: "#22C7DD" },
      { name: "Frontend", color: "#F0B429" },
      { name: "Documentação", color: "#8E44AD" },
    ];
    const labelIds = {};
    for (const et of etiquetasDef) {
      const { rows } = await client.query(
        `INSERT INTO labels (project_id, name, color) VALUES ($1, $2, $3) RETURNING id`,
        [projectId, et.name, et.color]
      );
      labelIds[et.name] = rows[0].id;
    }

    console.log("A criar tarefas de exemplo...");
    const tarefas = [
      { title: "Migrar base de dados de Supabase para PostgreSQL local", col: 3, prio: "alta", assignee: 0, labels: ["Backend"] },
      { title: "Configurar RLS e políticas de acesso", col: 3, prio: "alta", assignee: 0, labels: ["Backend", "Urgente"] },
      { title: "Implementar autenticação JWT local", col: 1, prio: "alta", assignee: 1, labels: ["Backend"] },
      { title: "Rever esquema da tabela de utilizadores", col: 2, prio: "media", assignee: 2, labels: ["Backend"] },
      { title: "Criar endpoint de exportação de CV em PDF", col: 0, prio: "media", assignee: 1, labels: ["Backend", "Frontend"] },
      { title: "Escrever testes do módulo de upload de ficheiros", col: 0, prio: "baixa", assignee: 2, labels: [] },
      { title: "Documentar API no relatório técnico", col: 1, prio: "media", assignee: 0, labels: ["Documentação"] },
    ];

    for (const [i, t] of tarefas.entries()) {
      const { rows } = await client.query(
        `INSERT INTO tasks (project_id, column_id, title, priority, assignee_id, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [projectId, colIds[t.col], t.title, t.prio, userIds[t.assignee], i, userIds[0]]
      );
      const taskId = rows[0].id;
      for (const nomeEtiqueta of t.labels) {
        await client.query(`INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)`, [taskId, labelIds[nomeEtiqueta]]);
      }
      await client.query(
        `INSERT INTO activity_log (project_id, user_id, action, details)
         VALUES ($1, $2, 'task.created', $3)`,
        [projectId, userIds[0], JSON.stringify({ taskId, title: t.title })]
      );

      // Adiciona uma checklist de exemplo à primeira tarefa
      if (i === 0) {
        const itensChecklist = [
          { content: "Exportar dados do Supabase", done: true },
          { content: "Criar schema local em PostgreSQL", done: true },
          { content: "Ajustar variáveis de ambiente", done: false },
          { content: "Validar integridade dos dados migrados", done: false },
        ];
        for (const [pos, item] of itensChecklist.entries()) {
          await client.query(
            `INSERT INTO checklist_items (task_id, content, is_done, position) VALUES ($1, $2, $3, $4)`,
            [taskId, item.content, item.done, pos]
          );
        }
      }
    }

    await client.query(
      `INSERT INTO comments (task_id, user_id, content)
       SELECT id, $1, 'Já iniciei a análise desta tarefa — deve ficar pronta até ao final da semana.'
       FROM tasks LIMIT 1`,
      [userIds[1]]
    );

    await client.query("COMMIT");
    console.log("\nSeed concluído com sucesso!");
    console.log("Utilizadores de teste (password: 123456):");
    users.forEach((u) => console.log(`   - ${u.email}`));
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro ao executar seed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
