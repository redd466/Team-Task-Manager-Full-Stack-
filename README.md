## Live Demo
https://team-task-manager-full-stack-production-3a6d.up.railway.app

# Team Task

Full-stack project and task management app with authentication, team roles, project membership, task assignment, progress tracking, and a dashboard.

## Features

- Signup and login with JWT authentication.
- PostgreSQL database with users, projects, project members, and tasks.
- Role-based access control:
  - Admins can manage projects, members, and tasks.
  - Members can view project work and update their assigned task status.
- Project creation, team management, task assignment, due dates, priorities, and status tracking.
- Dashboard for total tasks, completed tasks, overdue tasks, assigned open tasks, and due-soon work.
- React frontend served by the Express backend in production.

## Local Setup

Create `backend/.env` from `backend/.env.example` and set:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/team_task
JWT_SECRET=replace-with-a-long-random-secret
```

Install dependencies:

```bash
npm install
```

Build the frontend:

```bash
npm run build
```

Start the app:

```bash
npm start
```

Open `http://localhost:5000`.

For development, run the backend and frontend in separate terminals:

```bash
npm run backend
npm run frontend
```

## Railway Deployment

1. Create a new Railway project.
2. Add a PostgreSQL database service.
3. Deploy this repository/app service.
4. Set these variables on the app service:
   - `DATABASE_URL` from the Railway PostgreSQL service.
   - `JWT_SECRET` as a long random string.
   - `NODE_ENV=production`
5. Railway will run `npm install`, `npm run build`, and `npm start`.
6. Use the generated Railway domain as the submission Live URL.

The app includes `railway.json` with the build command, start command, and `/api/health` health check.
