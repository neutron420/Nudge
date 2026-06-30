FROM node:20-alpine AS builder
WORKDIR /usr/src/app

COPY package*.json ./
COPY packages/db/package*.json ./packages/db/
COPY apps/backend/package*.json ./apps/backend/

RUN npm ci

COPY packages/db ./packages/db/
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

COPY apps/backend ./apps/backend/
RUN npm run build --workspace=backend

FROM node:20-alpine AS runner

WORKDIR /usr/src/app

COPY package*.json ./
COPY packages/db/package*.json ./packages/db/
COPY apps/backend/package*.json ./apps/backend/

RUN npm ci --omit=dev

COPY --from=builder /usr/src/app/packages/db/generated ./packages/db/generated
COPY --from=builder /usr/src/app/apps/backend/dist ./apps/backend/dist

EXPOSE 5000
ENV NODE_ENV=production
CMD ["node", "apps/backend/dist/server.js"]
