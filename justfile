setup:
    bun install --frozen-lockfile
    rustup target add wasm32-unknown-unknown

dev:
    bun run dev

build:
    bun run build

format:
    bun run format

lint:
    bun run lint

test:
    bun run test

check:
    bun run check
