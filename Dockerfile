FROM node:22-slim

# Wrangler's local runtime (workerd) needs glibc, so Debian slim is used instead of Alpine.
ENV NODE_ENV=development \
    PERSIST_TO=/data \
    REGISTRATION_OPEN=true \
    PORT=8787

WORKDIR /app

# A lockfile is used when present; otherwise a normal install creates one inside the image.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .

RUN chmod +x scripts/docker-start.sh && mkdir -p /data

EXPOSE 8787
VOLUME ["/data"]

CMD ["sh", "scripts/docker-start.sh"]
