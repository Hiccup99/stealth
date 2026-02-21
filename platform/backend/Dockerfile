FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Install Node deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Compile TypeScript
RUN npx tsc

# Data directory for JSON config store
RUN mkdir -p /app/data/configs

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

CMD ["node", "dist/server.js"]
