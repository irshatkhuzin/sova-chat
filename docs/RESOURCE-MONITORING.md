# Resource monitoring

Monitor the application and its dependencies using your preferred monitoring
system. This repository does not contain deployment credentials, host-specific
monitoring scripts, or recurring automations.

Check:

- Available RAM, sustained swap use, CPU/load, process restarts.
- Disk usage and inodes, including private attachment storage and logs.
- MySQL availability, connection usage, database growth, and backup restoration.
- Redis availability, memory pressure, write failures, and queue backlog.
- HTTP health, login, delivery latency, translation failures, and AI usage.

`GET /api/v1/health` reports database/Redis status and support-provider readiness.
It is not a complete end-to-end check. `pm2 monit` and PM2 logs help diagnose
process failures. Configure log retention and protect reports from public access.

Alert on meaningful failures and sustained capacity pressure. Choose thresholds
using measured workload and host capacity. Do not delete customer data or clear
shared Redis databases as an automatic response to low disk or memory.

See [deployment](DEPLOY.md) and [shared VPS guidance](VPS-COEXISTENCE.md).