# Multi-stage build for optimization
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --production

# Final stage
FROM node:18-slim

WORKDIR /app

# Create app user for security
RUN useradd -m -u 1001 nodeuser

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY package.json .
COPY server.js .
COPY src/ ./src/
COPY .env.example .env.example

# Set environment variables with defaults
ENV NODE_ENV=production
ENV QUERY_TIMEOUT=30000
ENV MAX_ROWS=1000
ENV DEBUG=false

# Change ownership
RUN chown -R nodeuser:nodeuser /app

# Switch to non-root user
USER nodeuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('OK')" || exit 1

# Start server
CMD ["node", "server.js"]
