# syntax=docker/dockerfile:1

# ---- build: compile the Vite/React SPA to static assets ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
RUN npm ci --workspace=@flowforge/frontend --include-workspace-root
COPY frontend ./frontend
RUN npm run --workspace=@flowforge/frontend build

# ---- runtime: serve the static build with nginx and proxy the API ----
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
