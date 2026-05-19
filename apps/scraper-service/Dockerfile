# Playwright + Clearbolt scraper service (Fly.io)
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.json ./
COPY packages ./packages
COPY apps/scraper-service ./apps/scraper-service
COPY apps/cli ./apps/cli

RUN pnpm install --frozen-lockfile \
  && pnpm exec tsc -b packages/scraper apps/cli apps/scraper-service

ENV PORT=8791
EXPOSE 8791

CMD ["node", "apps/scraper-service/dist/server.js"]
