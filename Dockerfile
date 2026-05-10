FROM node:20-bookworm-slim

# Install .NET 9 runtime + tools needed for downloading DCE
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates unzip \
    && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/pmp.deb \
    && dpkg -i /tmp/pmp.deb \
    && rm /tmp/pmp.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-runtime-9.0 \
    && rm -rf /var/lib/apt/lists/*

# Download DiscordChatExporter CLI (framework-dependent, .NET assemblies only)
RUN mkdir -p /opt/dce \
    && wget -q https://github.com/Tyrrrz/DiscordChatExporter/releases/download/2.43.3/DiscordChatExporter.Cli.zip -O /tmp/dce.zip \
    && unzip /tmp/dce.zip -d /opt/dce \
    && rm /tmp/dce.zip \
    && ls -la /opt/dce

# Build our sync app
WORKDIR /sync
COPY package.json ./
RUN npm install --omit=dev || npm install --production || true
COPY sync.js ./

CMD ["node", "sync.js"]
