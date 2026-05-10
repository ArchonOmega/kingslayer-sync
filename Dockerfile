# Stage 1: pull the official DCE image just to extract its files
FROM tyrrrz/discordchatexporter:stable AS dce_source

# Stage 2: Node.js base with .NET runtime added
FROM node:20-bookworm-slim

# Install .NET runtime — DCE needs it to execute
RUN apt-get update \
    && apt-get install -y --no-install-recommends wget ca-certificates \
    && wget -q https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -O /tmp/pmp.deb \
    && dpkg -i /tmp/pmp.deb \
    && rm /tmp/pmp.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-runtime-9.0 \
    && rm -rf /var/lib/apt/lists/*

# Copy DCE binaries from the official image — try both possible paths
COPY --from=dce_source /opt/app /opt/dce

# Build our sync app
WORKDIR /sync
COPY package.json ./
RUN npm install --omit=dev || npm install --production || true
COPY sync.js ./

CMD ["node", "sync.js"]
