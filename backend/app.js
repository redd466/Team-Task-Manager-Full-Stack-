const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-before-deploy";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Add a Postgres database before starting the app.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const allowedStatuses = ["todo", "in-progress", "review", "done"];
const allowedPriorities = ["low", "medium", "high"];
const allowedRoles = ["admin", "member"];

function sendError(res, status, message, details) {
  return res.status(status).json({ message, details });
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function requireText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidDate(value) {
  return (
    !value ||
    (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
  );
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(160) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      description TEXT DEFAULT '',
      due_date DATE,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS project_members (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(project_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title VARCHAR(180) NOT NULL,
      description TEXT DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in-progress', 'review', 'done')),
      priority VARCHAR(20) NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high')),
      due_date DATE,
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_project_members_user
      ON project_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_project
      ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee
      ON tasks(assignee_id);
  `);
}

async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return sendError(res, 401, "Authentication required.");
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(
      "SELECT id, name, email FROM users WHERE id = $1",
      [decoded.id]
    );

    if (result.rowCount === 0) {
      return sendError(res, 401, "User no longer exists.");
    }

    req.user = result.rows[0];
    return next();
  } catch (error) {
    return sendError(res, 401, "Invalid or expired token.");
  }
}

async function getMembership(projectId, userId) {
  const result = await pool.query(
    "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]
  );

  return result.rows[0] || null;
}

async function requireProjectAccess(req, res, next) {
  const projectId = Number(req.params.projectId || req.params.id);

  if (!Number.isInteger(projectId)) {
    return sendError(res, 400, "Invalid project id.");
  }

  const membership = await getMembership(projectId, req.user.id);

  if (!membership) {
    return sendError(res, 403, "You do not have access to this project.");
  }

  req.projectId = projectId;
  req.membership = membership;
  return next();
}

function requireProjectAdmin(req, res, next) {
  if (req.membership?.role !== "admin") {
    return sendError(res, 403, "Admin access is required for this action.");
  }

  return next();
}

function mapTask(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    assigneeEmail: row.assignee_email,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "connected" });
  } catch {
    sendError(res, 503, "Database is not connected.");
  }
});

app.post("/api/auth/signup", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!requireText(name)) {
    return sendError(res, 400, "Name is required.");
  }

  if (!isEmail(email)) {
    return sendError(res, 400, "A valid email is required.");
  }

  if (password.length < 6) {
    return sendError(res, 400, "Password must be at least 6 characters.");
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name, email, passwordHash]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (error) {
    if (error.code === "23505") {
      return sendError(res, 409, "An account with this email already exists.");
    }

    return sendError(res, 500, "Could not create account.");
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!isEmail(email) || !password) {
    return sendError(res, 400, "Email and password are required.");
  }

  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = result.rows[0];

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return sendError(res, 401, "Invalid email or password.");
  }

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    token: signToken(user),
  });
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/projects", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT
      p.id,
      p.name,
      p.description,
      p.due_date AS "dueDate",
      pm.role,
      COUNT(DISTINCT t.id)::INT AS "taskCount",
      COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END)::INT AS "doneCount",
      COUNT(DISTINCT project_members.id)::INT AS "memberCount"
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
     LEFT JOIN tasks t ON t.project_id = p.id
     LEFT JOIN project_members ON project_members.project_id = p.id
     GROUP BY p.id, pm.role
     ORDER BY p.updated_at DESC`,
    [req.user.id]
  );

  res.json(result.rows);
});

app.post("/api/projects", auth, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const dueDate = req.body.dueDate || null;

  if (!requireText(name)) {
    return sendError(res, 400, "Project name is required.");
  }

  if (!isValidDate(dueDate)) {
    return sendError(res, 400, "Project due date must use YYYY-MM-DD format.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const projectResult = await client.query(
      `INSERT INTO projects (name, description, due_date, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, description, due_date AS "dueDate", created_at AS "createdAt"`,
      [name, description, dueDate, req.user.id]
    );
    const project = projectResult.rows[0];

    await client.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, 'admin')`,
      [project.id, req.user.id]
    );

    await client.query("COMMIT");
    res.status(201).json({ ...project, role: "admin", taskCount: 0, doneCount: 0, memberCount: 1 });
  } catch (error) {
    await client.query("ROLLBACK");
    sendError(res, 500, "Could not create project.");
  } finally {
    client.release();
  }
});

app.get("/api/projects/:id", auth, requireProjectAccess, async (req, res) => {
  const result = await pool.query(
    `SELECT id, name, description, due_date AS "dueDate", created_at AS "createdAt"
     FROM projects
     WHERE id = $1`,
    [req.projectId]
  );

  res.json({ ...result.rows[0], role: req.membership.role });
});

app.patch(
  "/api/projects/:id",
  auth,
  requireProjectAccess,
  requireProjectAdmin,
  async (req, res) => {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const dueDate = req.body.dueDate || null;

    if (!requireText(name)) {
      return sendError(res, 400, "Project name is required.");
    }

    if (!isValidDate(dueDate)) {
      return sendError(res, 400, "Project due date must use YYYY-MM-DD format.");
    }

    const result = await pool.query(
      `UPDATE projects
       SET name = $1, description = $2, due_date = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, description, due_date AS "dueDate"`,
      [name, description, dueDate, req.projectId]
    );

    res.json({ ...result.rows[0], role: req.membership.role });
  }
);

app.delete(
  "/api/projects/:id",
  auth,
  requireProjectAccess,
  requireProjectAdmin,
  async (req, res) => {
    await pool.query("DELETE FROM projects WHERE id = $1", [req.projectId]);
    res.status(204).send();
  }
);

app.get("/api/projects/:projectId/members", auth, requireProjectAccess, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, pm.role
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1
     ORDER BY pm.role, u.name`,
    [req.projectId]
  );

  res.json(result.rows);
});

app.post(
  "/api/projects/:projectId/members",
  auth,
  requireProjectAccess,
  requireProjectAdmin,
  async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const role = req.body.role || "member";

    if (!isEmail(email)) {
      return sendError(res, 400, "A valid member email is required.");
    }

    if (!allowedRoles.includes(role)) {
      return sendError(res, 400, "Role must be admin or member.");
    }

    const userResult = await pool.query(
      "SELECT id, name, email FROM users WHERE email = $1",
      [email]
    );

    if (userResult.rowCount === 0) {
      return sendError(res, 404, "That user has not signed up yet.");
    }

    const user = userResult.rows[0];
    const memberResult = await pool.query(
      `INSERT INTO project_members (project_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id)
       DO UPDATE SET role = EXCLUDED.role
       RETURNING role`,
      [req.projectId, user.id, role]
    );

    res.status(201).json({ ...user, role: memberResult.rows[0].role });
  }
);

app.delete(
  "/api/projects/:projectId/members/:userId",
  auth,
  requireProjectAccess,
  requireProjectAdmin,
  async (req, res) => {
    const userId = Number(req.params.userId);

    if (!Number.isInteger(userId)) {
      return sendError(res, 400, "Invalid user id.");
    }

    if (userId === req.user.id) {
      return sendError(res, 400, "Admins cannot remove themselves.");
    }

    await pool.query(
      "DELETE FROM project_members WHERE project_id = $1 AND user_id = $2",
      [req.projectId, userId]
    );

    res.status(204).send();
  }
);

app.get("/api/projects/:projectId/tasks", auth, requireProjectAccess, async (req, res) => {
  const result = await pool.query(
    `SELECT t.*, u.name AS assignee_name, u.email AS assignee_email
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.project_id = $1
     ORDER BY
       CASE t.status
         WHEN 'todo' THEN 1
         WHEN 'in-progress' THEN 2
         WHEN 'review' THEN 3
         ELSE 4
       END,
       t.due_date NULLS LAST,
       t.created_at DESC`,
    [req.projectId]
  );

  res.json(result.rows.map(mapTask));
});

app.post(
  "/api/projects/:projectId/tasks",
  auth,
  requireProjectAccess,
  requireProjectAdmin,
  async (req, res) => {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const status = req.body.status || "todo";
    const priority = req.body.priority || "medium";
    const dueDate = req.body.dueDate || null;
    const assigneeId = req.body.assigneeId ? Number(req.body.assigneeId) : null;

    if (!requireText(title)) {
      return sendError(res, 400, "Task title is required.");
    }

    if (!allowedStatuses.includes(status)) {
      return sendError(res, 400, "Invalid task status.");
    }

    if (!allowedPriorities.includes(priority)) {
      return sendError(res, 400, "Invalid task priority.");
    }

    if (!isValidDate(dueDate)) {
      return sendError(res, 400, "Task due date must use YYYY-MM-DD format.");
    }

    if (req.body.assigneeId && !Number.isInteger(assigneeId)) {
      return sendError(res, 400, "Assignee id must be a number.");
    }

    if (assigneeId) {
      const membership = await getMembership(req.projectId, assigneeId);
      if (!membership) {
        return sendError(res, 400, "Assignee must be a project member.");
      }
    }

    const result = await pool.query(
      `INSERT INTO tasks
       (project_id, title, description, status, priority, due_date, assignee_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.projectId, title, description, status, priority, dueDate, assigneeId, req.user.id]
    );

    const taskResult = await pool.query(
      `SELECT t.*, u.name AS assignee_name, u.email AS assignee_email
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE t.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json(mapTask(taskResult.rows[0]));
  }
);

app.patch("/api/tasks/:id", auth, async (req, res) => {
  const taskId = Number(req.params.id);

  if (!Number.isInteger(taskId)) {
    return sendError(res, 400, "Invalid task id.");
  }

  const taskResult = await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);

  if (taskResult.rowCount === 0) {
    return sendError(res, 404, "Task not found.");
  }

  const existing = taskResult.rows[0];
  const membership = await getMembership(existing.project_id, req.user.id);

  if (!membership) {
    return sendError(res, 403, "You do not have access to this task.");
  }

  const isAdmin = membership.role === "admin";
  const isAssignee = existing.assignee_id === req.user.id;

  if (!isAdmin && !isAssignee) {
    return sendError(res, 403, "Members can update only their assigned tasks.");
  }

  const title = isAdmin && req.body.title !== undefined
    ? String(req.body.title || "").trim()
    : existing.title;
  const description = isAdmin && req.body.description !== undefined
    ? String(req.body.description || "").trim()
    : existing.description;
  const status = req.body.status || existing.status;
  const priority = isAdmin && req.body.priority !== undefined ? req.body.priority : existing.priority;
  const dueDate = isAdmin && req.body.dueDate !== undefined ? req.body.dueDate || null : existing.due_date;
  const assigneeId = isAdmin && req.body.assigneeId !== undefined
    ? req.body.assigneeId
      ? Number(req.body.assigneeId)
      : null
    : existing.assignee_id;

  if (!requireText(title)) {
    return sendError(res, 400, "Task title is required.");
  }

  if (!allowedStatuses.includes(status)) {
    return sendError(res, 400, "Invalid task status.");
  }

  if (!allowedPriorities.includes(priority)) {
    return sendError(res, 400, "Invalid task priority.");
  }

  if (!isValidDate(dueDate)) {
    return sendError(res, 400, "Task due date must use YYYY-MM-DD format.");
  }

  if (req.body.assigneeId && !Number.isInteger(assigneeId)) {
    return sendError(res, 400, "Assignee id must be a number.");
  }

  if (assigneeId) {
    const assigneeMembership = await getMembership(existing.project_id, assigneeId);
    if (!assigneeMembership) {
      return sendError(res, 400, "Assignee must be a project member.");
    }
  }

  const result = await pool.query(
    `UPDATE tasks
     SET title = $1,
         description = $2,
         status = $3,
         priority = $4,
         due_date = $5,
         assignee_id = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING *`,
    [title, description, status, priority, dueDate, assigneeId, existing.id]
  );

  const updated = await pool.query(
    `SELECT t.*, u.name AS assignee_name, u.email AS assignee_email
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.id = $1`,
    [result.rows[0].id]
  );

  res.json(mapTask(updated.rows[0]));
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const taskId = Number(req.params.id);

  if (!Number.isInteger(taskId)) {
    return sendError(res, 400, "Invalid task id.");
  }

  const taskResult = await pool.query("SELECT * FROM tasks WHERE id = $1", [taskId]);

  if (taskResult.rowCount === 0) {
    return sendError(res, 404, "Task not found.");
  }

  const membership = await getMembership(taskResult.rows[0].project_id, req.user.id);

  if (!membership || membership.role !== "admin") {
    return sendError(res, 403, "Admin access is required for this action.");
  }

  await pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
  res.status(204).send();
});

app.get("/api/dashboard", auth, async (req, res) => {
  const stats = await pool.query(
    `SELECT
      COUNT(t.id)::INT AS total,
      COUNT(CASE WHEN t.status = 'done' THEN 1 END)::INT AS done,
      COUNT(CASE WHEN t.status != 'done' AND t.due_date < CURRENT_DATE THEN 1 END)::INT AS overdue,
      COUNT(CASE WHEN t.assignee_id = $1 AND t.status != 'done' THEN 1 END)::INT AS assigned_open
     FROM tasks t
     JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $1`,
    [req.user.id]
  );

  const byStatus = await pool.query(
    `SELECT t.status, COUNT(*)::INT AS count
     FROM tasks t
     JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $1
     GROUP BY t.status`,
    [req.user.id]
  );

  const dueSoon = await pool.query(
    `SELECT t.*, p.name AS project_name, u.name AS assignee_name, u.email AS assignee_email
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     JOIN project_members pm ON pm.project_id = t.project_id AND pm.user_id = $1
     LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.status != 'done'
     ORDER BY t.due_date NULLS LAST, t.priority DESC, t.created_at DESC
     LIMIT 8`,
    [req.user.id]
  );

  res.json({
    stats: stats.rows[0],
    byStatus: byStatus.rows,
    dueSoon: dueSoon.rows.map((row) => ({
      ...mapTask(row),
      projectName: row.project_name,
    })),
  });
});

const frontendBuildPath = path.join(__dirname, "..", "frontend", "build");

if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendBuildPath, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.send("API is working. Build the frontend to serve the full app.");
  });
}

initDb()
  .then(() => {
    
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });
