FROM oven/bun:1-alpine

RUN apk add --no-cache \
  git \
  tree \
  bash \
  nodejs \
  npm

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
