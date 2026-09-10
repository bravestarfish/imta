# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
# COREPACK_HOME keeps the pnpm binary inside the image so runtime stages never download it.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_HOME=/pnpm/corepack
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---- web: Next.js standalone server ---------------------------------------
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]

# ---- worker: background jobs + migrations ---------------------------------
FROM deps AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN groupadd -r app && useradd -r -m -g app app && chown -R app:app /app /pnpm
USER app
CMD ["pnpm", "worker"]
