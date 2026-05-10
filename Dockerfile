FROM node:20-bookworm-slim

# Install runtime libraries needed by DCE's self-contained build
# libicu is required for globalization features in .NET
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates unzip \
        libicu-dev libssl3 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Download the linux-x64 (glibc) self-contained DCE build
# This includes its own .NET runtime so we don't need to install one
RUN mkdir -p /opt/dce \
    && curl -L --fail --retry 3 --max-time 120 \
        -o /tmp/dce.zip \
        https://github.com/Tyrrrz/DiscordChatExporter/releases/latest/download/DiscordChatExporter.Cli.linux-x64.zip \
    && ls -la /tmp/dce.zip \
    && unzip /tmp/dce.zip -d /opt/dce \
    && rm /tmp/dce.zip \
    && chmod +x /opt/dce/DiscordChatExporter.Cli \
    && ls -la /opt/dce

# Build our sync app
WORKDIR /sync
COPY package.json ./
RUN npm install --omit=dev || npm install --production || true
COPY sync.js ./

CMD ["node", "sync.js"]
