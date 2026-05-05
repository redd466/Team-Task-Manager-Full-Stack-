import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addMember,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getDashboard,
  getMe,
  getMembers,
  getProjects,
  getTasks,
  login,
  removeMember,
  signup,
  updateTask,
} from "./api";
import "./App.css";

const emptyProject = { name: "", description: "", dueDate: "" };
const emptyMember = { email: "", role: "member" };
const emptyTask = {
  title: "",
  description: "",
  status: "todo",
  priority: "medium",
  dueDate: "",
  assigneeId: "",
};

const statuses = [
  { value: "todo", label: "To do" },
  { value: "in-progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

const priorities = ["low", "medium", "high"];

function App() {
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [members, setMembers] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [projectForm, setProjectForm] = useState(emptyProject);
  const [memberForm, setMemberForm] = useState(emptyMember);
  const [taskForm, setTaskForm] = useState(emptyTask);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const loadWorkspace = useCallback(async () => {
    const [dashboardData, projectData] = await Promise.all([
      getDashboard(),
      getProjects(),
    ]);
    setDashboard(dashboardData);
    setProjects(projectData);
    setSelectedProjectId((current) =>
      current || (projectData[0] ? String(projectData[0].id) : "")
    );
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("teamTaskToken");

    if (!token) {
      setLoading(false);
      return;
    }

    getMe()
      .then(({ user: currentUser }) => {
        setUser(currentUser);
        return loadWorkspace();
      })
      .catch(() => {
        localStorage.removeItem("teamTaskToken");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [loadWorkspace]);

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetails(selectedProjectId);
    } else {
      setMembers([]);
      setTasks([]);
    }
  }, [selectedProjectId]);

  async function loadProjectDetails(projectId) {
    try {
      setError("");
      const [memberData, taskData] = await Promise.all([
        getMembers(projectId),
        getTasks(projectId),
      ]);
      setMembers(memberData);
      setTasks(taskData);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAuth(event) {
    event.preventDefault();
    setSaving("auth");
    setError("");

    try {
      const action = authMode === "login" ? login : signup;
      const payload =
        authMode === "login"
          ? { email: authForm.email, password: authForm.password }
          : authForm;
      const result = await action(payload);

      localStorage.setItem("teamTaskToken", result.token);
      setUser(result.user);
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  function logout() {
    localStorage.removeItem("teamTaskToken");
    setUser(null);
    setProjects([]);
    setSelectedProjectId("");
    setMembers([]);
    setTasks([]);
    setDashboard(null);
  }

  async function handleCreateProject(event) {
    event.preventDefault();
    setSaving("project");
    setError("");

    try {
      const project = await createProject(projectForm);
      setProjects((current) => [project, ...current]);
      setSelectedProjectId(String(project.id));
      setProjectForm(emptyProject);
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  async function handleAddMember(event) {
    event.preventDefault();

    if (!selectedProjectId) {
      return;
    }

    setSaving("member");
    setError("");

    try {
      const member = await addMember(selectedProjectId, memberForm);
      setMembers((current) => [
        member,
        ...current.filter((item) => item.id !== member.id),
      ]);
      setMemberForm(emptyMember);
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault();

    if (!selectedProjectId) {
      return;
    }

    setSaving("task");
    setError("");

    try {
      const task = await createTask(selectedProjectId, {
        ...taskForm,
        assigneeId: taskForm.assigneeId || null,
      });
      setTasks((current) => [task, ...current]);
      setTaskForm(emptyTask);
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  async function handleStatusChange(task, status) {
    try {
      setError("");
      const updated = await updateTask(task.id, { status });
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? updated : item))
      );
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteTask(taskId) {
    try {
      setError("");
      await deleteTask(taskId);
      setTasks((current) => current.filter((task) => task.id !== taskId));
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeleteProject() {
    if (!selectedProjectId) {
      return;
    }

    try {
      setError("");
      await deleteProject(selectedProjectId);
      const remaining = projects.filter(
        (project) => String(project.id) !== String(selectedProjectId)
      );
      setProjects(remaining);
      setSelectedProjectId(remaining[0] ? String(remaining[0].id) : "");
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemoveMember(memberId) {
    try {
      setError("");
      await removeMember(selectedProjectId, memberId);
      setMembers((current) => current.filter((member) => member.id !== memberId));
      await loadWorkspace();
    } catch (err) {
      setError(err.message);
    }
  }

  const selectedProject = projects.find(
    (project) => String(project.id) === String(selectedProjectId)
  );
  const isAdmin = selectedProject?.role === "admin";
  const filteredTasks = useMemo(() => {
    const term = query.trim().toLowerCase();

    return tasks.filter((task) =>
      [task.title, task.description, task.assigneeName, task.priority, task.status]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [query, tasks]);

  if (loading) {
    return <div className="loading-screen">Loading workspace...</div>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-panel">
          <div>
            <p className="eyebrow">Team Task</p>
            <h1>Project work, roles, and progress in one place.</h1>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <form className="auth-form" onSubmit={handleAuth}>
            {authMode === "signup" && (
              <label>
                Name
                <input
                  value={authForm.name}
                  onChange={(event) =>
                    setAuthForm({ ...authForm, name: event.target.value })
                  }
                  placeholder="Your name"
                />
              </label>
            )}
            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) =>
                  setAuthForm({ ...authForm, email: event.target.value })
                }
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm({ ...authForm, password: event.target.value })
                }
                placeholder="At least 6 characters"
              />
            </label>
            <button className="primary-button" disabled={saving === "auth"}>
              {saving === "auth"
                ? "Please wait..."
                : authMode === "login"
                  ? "Log in"
                  : "Create account"}
            </button>
          </form>

          <button
            className="link-button"
            type="button"
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setError("");
            }}
          >
            {authMode === "login"
              ? "Need an account? Sign up"
              : "Already registered? Log in"}
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Team Task</p>
          <h1>Projects</h1>
        </div>

        <div className="user-card">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
          <button type="button" onClick={logout}>
            Logout
          </button>
        </div>

        <div className="project-list">
          {projects.length === 0 ? (
            <p className="muted">Create a project to begin.</p>
          ) : (
            projects.map((project) => (
              <button
                className={
                  String(project.id) === String(selectedProjectId) ? "active" : ""
                }
                key={project.id}
                type="button"
                onClick={() => setSelectedProjectId(String(project.id))}
              >
                <span>{project.name}</span>
                <small>{project.role}</small>
              </button>
            ))
          )}
        </div>

        <form className="mini-form" onSubmit={handleCreateProject}>
          <h2>New project</h2>
          <input
            value={projectForm.name}
            onChange={(event) =>
              setProjectForm({ ...projectForm, name: event.target.value })
            }
            placeholder="Project name"
          />
          <textarea
            value={projectForm.description}
            onChange={(event) =>
              setProjectForm({ ...projectForm, description: event.target.value })
            }
            placeholder="Goal or scope"
            rows="3"
          />
          <input
            type="date"
            value={projectForm.dueDate}
            onChange={(event) =>
              setProjectForm({ ...projectForm, dueDate: event.target.value })
            }
          />
          <button className="primary-button" disabled={saving === "project"}>
            {saving === "project" ? "Creating..." : "Create project"}
          </button>
        </form>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h2>{selectedProject?.name || "Workspace overview"}</h2>
            {selectedProject?.description && <p>{selectedProject.description}</p>}
          </div>
          {isAdmin && selectedProject && (
            <button className="danger-button" type="button" onClick={handleDeleteProject}>
              Delete project
            </button>
          )}
        </header>

        {error && <div className="error-banner">{error}</div>}

        <section className="stats-grid" aria-label="Dashboard status">
          <Stat label="All tasks" value={dashboard?.stats?.total || 0} />
          <Stat label="Completed" value={dashboard?.stats?.done || 0} />
          <Stat label="Overdue" value={dashboard?.stats?.overdue || 0} />
          <Stat label="Assigned open" value={dashboard?.stats?.assigned_open || 0} />
        </section>

        <section className="workspace-grid">
          <div className="panel tasks-panel">
            <div className="panel-heading">
              <div>
                <h2>Tasks</h2>
                <p>Members can update their assigned status. Admins manage all task details.</p>
              </div>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tasks"
              />
            </div>

            {selectedProject ? (
              <>
                {isAdmin && (
                  <form className="task-form" onSubmit={handleCreateTask}>
                    <input
                      value={taskForm.title}
                      onChange={(event) =>
                        setTaskForm({ ...taskForm, title: event.target.value })
                      }
                      placeholder="Task title"
                    />
                    <select
                      value={taskForm.assigneeId}
                      onChange={(event) =>
                        setTaskForm({ ...taskForm, assigneeId: event.target.value })
                      }
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option value={member.id} key={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={taskForm.priority}
                      onChange={(event) =>
                        setTaskForm({ ...taskForm, priority: event.target.value })
                      }
                    >
                      {priorities.map((priority) => (
                        <option value={priority} key={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={taskForm.dueDate}
                      onChange={(event) =>
                        setTaskForm({ ...taskForm, dueDate: event.target.value })
                      }
                    />
                    <textarea
                      value={taskForm.description}
                      onChange={(event) =>
                        setTaskForm({
                          ...taskForm,
                          description: event.target.value,
                        })
                      }
                      placeholder="Task details"
                      rows="2"
                    />
                    <button className="primary-button" disabled={saving === "task"}>
                      {saving === "task" ? "Adding..." : "Add task"}
                    </button>
                  </form>
                )}

                <div className="task-list">
                  {filteredTasks.length === 0 ? (
                    <div className="empty-state">No tasks yet.</div>
                  ) : (
                    filteredTasks.map((task) => (
                      <article className={`task-card ${task.priority}`} key={task.id}>
                        <div className="task-card-head">
                          <div>
                            <span className="status-pill">{formatStatus(task.status)}</span>
                            <h3>{task.title}</h3>
                          </div>
                          <select
                            value={task.status}
                            onChange={(event) =>
                              handleStatusChange(task, event.target.value)
                            }
                          >
                            {statuses.map((status) => (
                              <option value={status.value} key={status.value}>
                                {status.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <p>{task.description || "No description added."}</p>
                        <div className="task-meta">
                          <span>{task.assigneeName || "Unassigned"}</span>
                          <span>{task.dueDate ? `Due ${task.dueDate}` : "No due date"}</span>
                          <span>{task.priority} priority</span>
                        </div>
                        {isAdmin && (
                          <div className="task-actions">
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">Select or create a project.</div>
            )}
          </div>

          <div className="side-stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Team</h2>
                  <p>Project roles control access.</p>
                </div>
              </div>

              {isAdmin && selectedProject && (
                <form className="member-form" onSubmit={handleAddMember}>
                  <input
                    type="email"
                    value={memberForm.email}
                    onChange={(event) =>
                      setMemberForm({ ...memberForm, email: event.target.value })
                    }
                    placeholder="member@email.com"
                  />
                  <select
                    value={memberForm.role}
                    onChange={(event) =>
                      setMemberForm({ ...memberForm, role: event.target.value })
                    }
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button className="primary-button" disabled={saving === "member"}>
                    Add
                  </button>
                </form>
              )}

              <div className="member-list">
                {members.map((member) => (
                  <div className="member-row" key={member.id}>
                    <div>
                      <strong>{member.name}</strong>
                      <span>{member.email}</span>
                    </div>
                    <span className="role-pill">{member.role}</span>
                    {isAdmin && member.id !== user.id && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(member.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Due soon</h2>
                  <p>Open work across your projects.</p>
                </div>
              </div>
              <div className="due-list">
                {(dashboard?.dueSoon || []).length === 0 ? (
                  <div className="empty-state">Nothing due yet.</div>
                ) : (
                  dashboard.dueSoon.map((task) => (
                    <div className="due-row" key={task.id}>
                      <strong>{task.title}</strong>
                      <span>{task.projectName}</span>
                      <small>{task.dueDate || "No due date"}</small>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatStatus(status) {
  return statuses.find((item) => item.value === status)?.label || status;
}

export default App;
