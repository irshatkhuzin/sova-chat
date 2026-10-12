# Running on a shared VPS

A small shared server can run Sova, but capacity depends on traffic, media,
database load, and other applications. Measure before choosing limits.

## Isolation

- Prefer a dedicated MySQL database and account.
- Choose an unused Redis database and a unique `REDIS_PREFIX`.
- Redis logical databases are not a security boundary. Use a suitable ACL or a
  separate Redis instance when applications should not share access.
- Choose an unused loopback port and a dedicated reverse-proxy route.
- Keep production credentials and attachment storage outside public files.

Inspect memory, disk, processes, ports, and Redis policy before installation:

```sh
free -h
df -h
pm2 status
ss -ltnp
redis-cli INFO memory
redis-cli CONFIG GET maxmemory-policy
```

Use your server's secure authentication method when required; do not paste
credentials into shared command logs.

## Memory and build strategy

Use the default combined PM2 mode to avoid a second Node process. Start with
`WORKER_CONCURRENCY=2` and a modest `DB_CONNECTION_LIMIT` (for example, 6),
then measure actual load. V8 heap limits do not cap total process RSS; media
subprocesses and native allocations also consume memory.

Build on a development or CI machine if the VPS has little free memory.
Deploy build output and run `npm ci --omit=dev` on the target. Do not copy
Windows `node_modules` to Linux. Production dependency installation may still
need memory and network access.

Do not stop unrelated applications or change global MySQL/Redis settings just
to install Sova. Plan shared-service changes with their owners.

## Redis queues

Queue data must not be treated as disposable cache. An eviction policy that can
remove queue keys can disrupt background work. Prefer a separately provisioned
queue Redis with suitable capacity and no eviction, and monitor write failures
and memory pressure. TTL caches also need enough capacity.

Do not run `FLUSHALL` or `FLUSHDB` on shared services. A key prefix reduces
collisions but does not make destructive administrative commands safe.

## Database

The default full-text configuration may omit short words; retrieval also has a
fallback. Tuning `innodb_ft_min_token_size` or `ngram_token_size` affects the
whole database server and can require index rebuilding. Treat this as planned
database maintenance, not a prerequisite for running Sova.

## Monitoring and recovery

Watch available RAM, sustained swap use, process restarts, disk/inodes, queue
backlogs, Redis errors, and database growth. Do not rely only on heap size or
the health endpoint.

Back up Sova's database, configured storage directory, and encryption key.
Keep a tested rollback path for application updates, including schema changes.
See [deployment](DEPLOY.md) and [resource monitoring](RESOURCE-MONITORING.md).