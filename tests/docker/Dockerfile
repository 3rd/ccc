FROM node:24-alpine3.22 AS node

FROM oven/bun:1-alpine

RUN apk add --no-cache \
  git \
  tree \
  bash \
  libstdc++

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN npm install -g tsx

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

RUN mkdir -p /home/bun/.claude && chown -R bun:bun /home/bun/.claude
RUN chown -R bun:bun /app

ENV HOME=/home/bun
USER bun

CMD ["bun", "test", "tests/e2e"]
