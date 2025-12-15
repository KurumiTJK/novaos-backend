# ═══════════════════════════════════════════════════════════════════════════════
# NOVAOS BACKEND — Production Dockerfile
# Multi-stage build for minimal image size
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────────
# STAGE 1: Build
# ─────────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# ─────────────────────────────────────────────────────────────────────────────────
# STAGE 2: Production
# ─────────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S novaos -u 1001 -G nodejs

WORKDIR /app

# Copy built artifacts
COPY --from=builder --chown=novaos:nodejs /app/dist ./dist
COPY --from=builder --chown=novaos:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=novaos:nodejs /app/package.json ./

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run as non-root
USER novaos

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/server.js"]

# ─────────────────────────────────────────────────────────────────────────────────
# LABELS
# ─────────────────────────────────────────────────────────────────────────────────
LABEL org.opencontainers.image.title="NovaOS Backend"
LABEL org.opencontainers.image.description="Nova Constitution enforcement backend"
LABEL org.opencontainers.image.version="7.0.0"
LABEL org.opencontainers.image.vendor="NovaOS"
