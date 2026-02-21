FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS builder

WORKDIR /app

# Install all deps (including dev) so we can compile TypeScript
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY . .
RUN npx tsc

# ─── Production stage ───────────────────────────────────────────────────────

FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled output and config data from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/data ./data

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/server.js"]
