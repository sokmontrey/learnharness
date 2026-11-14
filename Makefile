# LearnHarness — build the standalone web app and deploy it into the
# user-level systemd unit.
#
# The unit already exists at ~/.config/systemd/user/learnharness-web.service
# and runs:
#   node .next/standalone/server.js
# This Makefile owns the build half (Next standalone + the static/public
# curation) and the restart half. Data lives outside the repo via the
# unit's LH_DATA_DIR / LH_AUTH_FILE — it is never part of the build.
#
# Usage:
#   make build    # next build + scripts/build-server.mjs (static/public copy)
#   make deploy   # build, then restart the service
#   make restart  # restart only (an already-built tree)
#   make status   # systemctl status
#   make logs     # follow the journal
#   make clean    # remove the standalone output

SERVICE ?= learnharness-web.service
NODE    ?= node
NPM     ?= npm
PORT    ?= 3000

STANDALONE := .next/standalone
UNIT       := $(HOME)/.config/systemd/user/$(SERVICE)
LOCK       := .next/deploy.lock

.DEFAULT_GOAL := help
.PHONY: help build deploy deploy-serial restart status logs verify clean check-unit

help:
	@echo "LearnHarness targets:"
	@echo "  make build     Build the standalone server (.next/standalone)"
	@echo "  make deploy    Build, then restart $(SERVICE)"
	@echo "  make restart   Restart $(SERVICE) without rebuilding"
	@echo "  make verify    Check that the deployed build's chunks serve 200"
	@echo "  make status    Show $(SERVICE) status"
	@echo "  make logs      Follow $(SERVICE) journal"
	@echo "  make clean     Remove .next/standalone"
	@echo ""
	@echo "Override the unit with: make deploy SERVICE=other.service"

build:
	$(NPM) run build
	$(NODE) scripts/build-server.mjs
	@test -f $(STANDALONE)/server.js || { \
		echo "build failed: $(STANDALONE)/server.js is missing" >&2; exit 1; }

# The unit is user-level and already installed; deploy only rebuilds and
# restarts. If it is missing, say exactly where to look instead of
# guessing a unit definition.
check-unit:
	@test -f $(UNIT) || { \
		echo "missing unit: $(UNIT)" >&2; \
		echo "install it first (then: systemctl --user daemon-reload)" >&2; \
		exit 1; }

# One deploy at a time: a concurrent `make deploy` would let one run's
# restart land while the other is still copying static chunks into the
# live tree — and Next caches the static name list at startup, so chunks
# copied after boot 404 until the next restart (the 2026-11-12 report).
# The lock serialises the whole build+restart sequence across terminals.
deploy: check-unit
	@mkdir -p .next
	@command -v flock >/dev/null 2>&1 || { echo "flock (util-linux) is required" >&2; exit 1; }
	@flock $(LOCK) $(MAKE) --no-print-directory deploy-serial

# Explicit sub-makes: ordering is guaranteed even under `make -j`, and
# each step finishes before the next begins.
deploy-serial:
	@$(MAKE) --no-print-directory build
	@$(MAKE) --no-print-directory restart
	@$(MAKE) --no-print-directory verify
	@echo "deployed: $(SERVICE) serves the freshly built standalone app"

verify:
	@bad=0; \
	for p in "/" "/chat/new?mode=ask"; do \
		html=$$(curl -fs --retry 30 --retry-connrefused --retry-delay 1 "http://127.0.0.1:$(PORT)$$p") || { \
			echo "verify: GET $$p failed" >&2; exit 1; }; \
		for u in $$(printf '%s' "$$html" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u); do \
			code=$$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$(PORT)$$u"); \
			[ "$$code" = "200" ] || { echo "verify: $$u -> $$code" >&2; bad=1; }; \
		done; \
	done; \
	[ $$bad -eq 0 ] && echo "verify: all referenced chunks serve 200"

restart: check-unit
	systemctl --user restart $(SERVICE)

status: check-unit
	-systemctl --user status $(SERVICE) --no-pager

logs: check-unit
	journalctl --user -u $(SERVICE) -f

clean:
	rm -rf $(STANDALONE)
