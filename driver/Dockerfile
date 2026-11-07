# The browser driver. The Playwright base image carries the browsers and its own Node; this is a tool container,
# not the app, so it is not held to the app's Node 26 rule. Build from the repo root: docker compose --profile drive build driver
FROM mcr.microsoft.com/playwright:v1.59.1-noble
WORKDIR /driver
COPY driver/package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY driver/targets.mjs driver/drive.mjs ./
USER pwuser
CMD ["node", "drive.mjs"]
