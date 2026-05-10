# Use the official DiscordChatExporter image — has DCE + .NET runtime
FROM tyrrrz/discordchatexporter:stable

# Install Node.js on top of it
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /sync
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install
COPY sync.js ./

CMD ["node", "sync.js"]
