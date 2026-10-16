# Multi-stage Dockerfile for Production-Oriented PDF Microservice
FROM node:20-bullseye-slim AS base

# Install necessary libraries for Chromium headless execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libasound2 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Stage 2: Dependencies
FROM base AS dependencies
COPY package*.json ./
RUN npm ci

# Stage 3: Build
FROM dependencies AS build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
# Copy HTML and CSS templates to dist/templates
RUN cp -r src/templates/invoice dist/templates/ && \
    cp -r src/templates/purchase-order dist/templates/ && \
    cp -r src/database/migrations dist/database/

# Stage 4: Production Runtime
FROM base AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=build /app/dist ./dist

# Create storage directory with appropriate permissions
RUN mkdir -p /app/data/storage && chown -R node:node /app

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
