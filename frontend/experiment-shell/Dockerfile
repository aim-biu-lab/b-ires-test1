FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build arguments for environment variables
# Leave VITE_API_URL empty to use relative /api URLs (works with nginx proxy)
ARG VITE_API_URL=
ENV VITE_API_URL=$VITE_API_URL

# Increase Node.js memory limit for build
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Build the application
RUN npm run build

# Production image
FROM nginx:alpine

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]

