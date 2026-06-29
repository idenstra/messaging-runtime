.DEFAULT_GOAL := help

.PHONY: help format lint audit verify-fast verify plan-sync

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_.-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

format: ## Format repo-owned source, scripts, and docs with Biome
	npm run format

lint: ## Lint repo-owned source, scripts, and docs with Biome
	npm run lint

audit: ## Run the deterministic harness audit
	node ./scripts/harness/audit.mjs

verify-fast: ## Run validator self-tests and the package verification gate
	HARNESS_STRICT=$${HARNESS_STRICT:-0} ./scripts/harness/verify.sh

verify: verify-fast ## Run the default repo verification gate

plan-sync: ## Move closed-issue execution plans from active to completed
	node ./scripts/harness/check-execution-plan-lifecycle.mjs --write
