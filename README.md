# FlowForge

Real-time, multi-tenant workflow orchestration engine — define, execute, monitor, and
collaborate on automated workflows (a self-hosted blend of Zapier's workflow engine and
GitHub Actions' execution model).

> Status: 🚧 Work in progress (technical-test MVP).

## Tech stack

| Layer      | Choice                                    |
| ---------- | ----------------------------------------- |
| Backend    | TypeScript · NestJS                       |
| Database   | PostgreSQL (Prisma)                       |
| Realtime   | Server-Sent Events (SSE)                  |
| Frontend   | React (Vite)                              |
| AI feature | Intelligent failure analysis (Claude API) |
| Infra      | Docker · docker-compose · GitHub Actions  |

## Repository layout

```
flowforge/
├── backend/    # NestJS API + workflow execution engine
├── frontend/   # React monitoring dashboard
├── docs/       # Architecture & infrastructure design docs
└── ...         # Root tooling (tsconfig, prettier, workspaces)
```

## Getting started

Setup instructions will be added as the stack comes together.

```bash
npm install
```
