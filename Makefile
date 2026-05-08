.PHONY: help install dev build preview tauri-dev tauri-build tauri-release lint typecheck test test-watch format format-check check clean

help:
	@echo "Maestro Deck - available commands:"
	@echo "  make install       Install dependencies (pnpm install)"
	@echo "  make dev           Start the Vite dev server (web)"
	@echo "  make build         Build web app (tsc + vite build)"
	@echo "  make preview       Preview the web build"
	@echo "  make tauri-dev     Run the Tauri app in dev mode"
	@echo "  make tauri-build   Build the Tauri app"
	@echo "  make tauri-release Build + notarize DMG"
	@echo "  make lint          Run ESLint"
	@echo "  make typecheck     Run TypeScript type checking"
	@echo "  make test          Run tests (vitest)"
	@echo "  make test-watch    Run tests in watch mode"
	@echo "  make format        Format code (prettier)"
	@echo "  make format-check  Check formatting"
	@echo "  make check         lint + typecheck + test"
	@echo "  make clean         Remove node_modules, dist and target"

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

preview:
	pnpm preview

tauri-dev:
	pnpm tauri:dev

tauri-build:
	pnpm tauri:build

tauri-release:
	pnpm tauri:release

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

test-watch:
	pnpm test:watch

format:
	pnpm format

format-check:
	pnpm format:check

check: lint typecheck test

clean:
	rm -rf node_modules dist src-tauri/target
