# The telemetry collector. No dependencies and no build step: node 22.18+ runs TypeScript directly,
# stripping the types as it loads, which is why the four files are copied in as they are and why their
# imports name each other with the .ts extension (server/tsconfig.json says the same).
# The image is pinned to one Node release so a rebuild does not pick up a new one unasked -- the same
# release Potion Siege's collector is on, so the box already has the layer. Bump it here and in the
# backup service's image in docker-compose.yml together.
FROM node:22.23.4-alpine
WORKDIR /app
COPY main.ts index.ts limits.ts wire.ts ./
# compose bind-mounts ./data here; without this, node could not create the directory itself
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8787 COLLECT_DIR=/data
EXPOSE 8787
# Type stripping is on by default from 22.18 and says so in an ExperimentalWarning on every start;
# what is experimental about it is the flag's name, and the line in the log is noise.
CMD ["node", "--disable-warning=ExperimentalWarning", "main.ts"]
