FROM node:20-bookworm-slim

# Install .NET 9 runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget curl ca-certificates unzip libicu-dev \
    && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/pmp.deb \
    && dpkg -i /tmp/pmp.deb \
    && rm /tmp/pmp.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-runtime-9.0 \
    && rm -rf /var/lib/apt/lists/*

# Download framework-dependent DCE (.NET assemblies only, runs on our dotnet runtime)
# Use curl -L to follow GitHub's redirect to release-assets.githubusercontent.com
RUN mkdir -p /opt/dce \
    && curl -L --fail --retry 3 --max-time 120 \
        -o /tmp/dce.zip \
        https://github.com/Tyrrrz/DiscordChatExporter/releases/latest/download/DiscordChatExporter.Cli.zip \
    && ls -la /tmp/dce.zip \
    && unzip /tmp/dce.zip -d /opt/dce \
    && rm /tmp/dce.zip \
    && ls -la /opt/dce

# Build our sync app
WORKDIR /sync
COPY package.json ./
RUN npm install --omit=dev || npm install --production || true
COPY sync.js ./

CMD ["node", "sync.js"]
