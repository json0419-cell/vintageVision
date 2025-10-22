# Google Cloud Run deployment configuration
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY backend/ ./
COPY *.html ./
COPY *.js ./
COPY *.css ./
COPY images/ ./images/

# Create logs directory
RUN mkdir -p logs

# Create public directory for static files
RUN mkdir -p public
RUN cp *.html public/ 2>/dev/null || true
RUN cp *.js public/ 2>/dev/null || true
RUN cp *.css public/ 2>/dev/null || true
RUN cp -r images public/ 2>/dev/null || true

# Expose port
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/health || exit 1

# Start the application
CMD ["npm", "start"]



