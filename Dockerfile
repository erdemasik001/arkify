# One Arkify verifier. Configured entirely through the environment:
#   VERIFIER_NAME, VERIFIER_PRIVATE_KEY, ARKIV_RPC_URL, ARKIV_WS_URL, SEPOLIA_RPC_URL, MAINNET_RPC_URL
FROM node:22-slim

RUN npm install --global pnpm@12.10.1 && mkdir -p /data && chown node:node /data
WORKDIR /app

# Manifests first, so the dependency layer is rebuilt only when they change.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY --chown=node:node packages/core/package.json packages/core/
COPY --chown=node:node packages/engine/package.json packages/engine/
COPY --chown=node:node packages/verifier/package.json packages/verifier/
COPY --chown=node:node packages/cli/package.json packages/cli/
COPY --chown=node:node apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@arkify/verifier..."

COPY --chown=node:node packages/core packages/core
COPY --chown=node:node packages/engine packages/engine
COPY --chown=node:node packages/verifier packages/verifier

# Downloaded solc builds are kept here; mount a volume to keep them across restarts.
ENV ARKIFY_SOLC_CACHE=/data/solc NODE_ENV=production
USER node
WORKDIR /app/packages/verifier
# tsx directly, not through pnpm: nothing should try to touch node_modules at run time.
CMD ["node_modules/.bin/tsx", "src/main.ts"]
