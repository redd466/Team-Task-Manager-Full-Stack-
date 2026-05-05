const API_BASE_URL = process.env.REACT_APP_API_URL || "/api";

async function request(path, options = {}) {
  const token = localStorage.getItem("teamTaskToken");
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const message = await getErrorMessage(response);
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function getErrorMessage(response) {
  try {
    const body = await response.json();
    return body.message || body.error || "Something went wrong.";
  } catch {
    return "Something went wrong.";
  }
}

export function signup(payload) {
  return request("/auth/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function login(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getMe() {
  return request("/me");
}

export function getDashboard() {
  return request("/dashboard");
}

export function getProjects() {
  return request("/projects");
}

export function createProject(payload) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProject(projectId, payload) {
  return request(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteProject(projectId) {
  return request(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function getMembers(projectId) {
  return request(`/projects/${projectId}/members`);
}

export function addMember(projectId, payload) {
  return request(`/projects/${projectId}/members`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function removeMember(projectId, userId) {
  return request(`/projects/${projectId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function getTasks(projectId) {
  return request(`/projects/${projectId}/tasks`);
}

export function createTask(projectId, payload) {
  return request(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTask(taskId, payload) {
  return request(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTask(taskId) {
  return request(`/tasks/${taskId}`, {
    method: "DELETE",
  });
}
