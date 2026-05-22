.PHONY: help install setup-hooks dev build preview tauri-dev tauri-build tauri-release lint typecheck test test-watch format format-check check clean

help:
	@echo "Maestro Deck - available commands:"
	@echo "  make install       Install dependencies (pnpm install)"
	@echo "  make setup-hooks   Install git hooks + gitleaks (auto-detects OS)"
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

setup-hooks:
	@pnpm exec lefthook install >/dev/null 2>&1 || true
	@if command -v gitleaks >/dev/null 2>&1; then \
		echo "✓ gitleaks already installed"; \
	elif [ "$$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then \
		echo "→ Installing gitleaks via Homebrew..."; \
		brew install gitleaks || echo "⚠️  Failed to install gitleaks via brew. Install manually: https://github.com/gitleaks/gitleaks#installing"; \
	elif [ "$$(uname)" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then \
		echo "⚠️  Install gitleaks manually on Linux: https://github.com/gitleaks/gitleaks/releases"; \
	else \
		echo "⚠️  gitleaks not auto-installed for your OS. Install manually: https://github.com/gitleaks/gitleaks#installing"; \
	fi

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
