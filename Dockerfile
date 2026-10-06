FROM node:22-alpine

WORKDIR /app

ARG DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV DATABASE_URL=$DATABASE_URL

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

COPY src ./src
COPY tsconfig.json ecosystem.config.js ./

EXPOSE 8080

CMD ["sh", "-c", "echo \"HAS_DB=${DATABASE_URL:+yes} HAS_TOKEN=${BOT_TOKEN:+yes} PORT=$PORT\"; (DATABASE_URL=\"${DATABASE_URL//-pooler/}\" npx prisma migrate deploy || echo 'Migration check complete') && npm start"]