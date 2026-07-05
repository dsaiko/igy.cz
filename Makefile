.PHONY: help setup build dev preview clean deploy login whoami

# Lokální overrides (CF_ACCOUNT_ID) — mimo git, viz Makefile.local.example.
-include Makefile.local

# Cloudflare Pages projekt. CF_ACCOUNT_ID nastav v Makefile.local.
CF_PROJECT     ?= igy-cz
CF_BRANCH      ?= main
CF_ACCOUNT_ID  ?=
PREVIEW_PORT   ?= 8091
WRANGLER       ?= npx --yes wrangler@latest

help:
	@echo "igy.cz — I Google You. Dostupné cíle:"
	@echo "  make setup     — npm install (závislosti Astro)"
	@echo "  make build     — astro build → dist/"
	@echo "  make dev       — astro dev (bez CF funkcí; /api/* vrací fallback)"
	@echo "  make preview   — build + wrangler pages dev (S CF funkcemi na http://localhost:$(PREVIEW_PORT))"
	@echo "  make clean     — smaže dist/"
	@echo ""
	@echo "  make login     — wrangler login (jednorázově, přes prohlížeč)"
	@echo "  make whoami    — ověří přihlášení k Cloudflare"
	@echo "  make deploy    — build + nasazení na Cloudflare Pages (projekt $(CF_PROJECT))"
	@echo ""
	@echo "Naživo: https://www.igy.cz  ·  https://$(CF_PROJECT).pages.dev"

node_modules: package.json
	npm install
setup: node_modules

build: node_modules
	npm run build
	@echo "→ dist/ hotové"

dev: node_modules
	npm run dev

# Náhled VČETNĚ Pages Functions (/api/whoami, /api/etag) — geolokace je lokálně
# omezená, ale funkce běží. Vyžaduje předchozí `make build`.
preview: build
	@echo "→ http://localhost:$(PREVIEW_PORT)/  (Ctrl-C ukončí)"
	$(WRANGLER) pages dev dist --port $(PREVIEW_PORT) --compatibility-date=2024-01-01

clean:
	rm -rf dist

login:
	$(WRANGLER) login

whoami:
	$(WRANGLER) whoami

# --- deploy na Cloudflare Pages ---------------------------------------------
# Nahraje dist/ + zkompiluje functions/ + _headers. Vyžaduje `make login`.
deploy: build
	@test -n "$(CF_ACCOUNT_ID)" || { echo "CF_ACCOUNT_ID není nastaven — zkopíruj Makefile.local.example na Makefile.local"; exit 1; }
	@echo "→ Cloudflare Pages: projekt $(CF_PROJECT), branch $(CF_BRANCH)"
	CLOUDFLARE_ACCOUNT_ID=$(CF_ACCOUNT_ID) $(WRANGLER) pages deploy dist \
		--project-name $(CF_PROJECT) --branch $(CF_BRANCH) --commit-dirty=true
