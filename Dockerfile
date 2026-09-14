# Veridian, in a container.
#
# What this file is for: one of the ways to *get* Veridian. It is a distribution route, not a
# sandbox environment - the distinction matters, because "Docker" appears in this project in two
# unrelated roles, and only this one is here. A container that runs the CLI is packaging. An adapter
# that starts, resets and observes an application inside a container is an environment, and it needs
# a container runtime on the host, which is why it is not in this file.
#
# Two stages, because the build toolchain (TypeScript, 5 MB of node_modules) has no business in the
# image that runs.
#
# The install uses --ignore-scripts deliberately. `package.json` declares `prepare`, which builds -
# and at the point of the first COPY the sources are not in the image yet, so letting it run would
# fail on a package that is merely not assembled yet. The build is therefore explicit and comes
# after every input it reads.

FROM node:22-bookworm-slim AS build

WORKDIR /src

# Dependencies first, so a source-only edit does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Then the compiler configuration and exactly the trees it compiles.
COPY tsconfig.json tsconfig.build.json ./
COPY cli ./cli
COPY core ./core
COPY adapters ./adapters
COPY validators ./validators
COPY schemas ./schemas
COPY scripts ./scripts

RUN npm run build

# Drop the dev toolchain from the tree we are about to carry forward.
RUN npm prune --omit=dev


FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/schemas ./schemas
COPY --from=build /src/package.json ./package.json
COPY LICENSE ./LICENSE

# The CLI is the interface. A goal, an acceptance contract and an environment document are the
# operator's to mount - they are not part of Veridian, and baking a demo into the image would make
# the image a fixture rather than a tool.
ENTRYPOINT ["node", "/app/dist/cli/veridian.js"]
CMD ["help"]
