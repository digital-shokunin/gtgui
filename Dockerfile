FROM node:20-bookworm

WORKDIR /app

# Install system deps for Playwright
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 tmux \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install deps
COPY package.json package-lock.json ./
RUN npm ci

# Install Playwright browsers
RUN npx playwright install chromium

# Copy the rest of the app
COPY . .

# Build frontend assets (vite build produces dist/)
RUN npm run build

# Set up mock gt binary
RUN cp tests/mock-gt.sh /usr/local/bin/gt && chmod +x /usr/local/bin/gt

# Create a mock town directory
RUN mkdir -p /root/gt/logs && \
    echo '[]' > /root/gt/activity_feed.json && \
    echo '[]' > /root/gt/task_queue.json

# Environment for testing
ENV NODE_ENV=development
ENV GT_PATH=/usr/local/bin/gt
ENV TOWN_ROOT=/root/gt
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
