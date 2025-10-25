include .env
.PHONY: up logs ps down check reload
check:
	@./bin/port-guard.sh || (echo "Port check failed"; exit 1)
up: check
	docker compose up -d --pull=always
logs:
	docker compose logs -f --tail=200
ps:
	docker compose ps
down:
	docker compose down
reload:
	docker compose exec proxy caddy reload --config /etc/caddy/Caddyfile --force
