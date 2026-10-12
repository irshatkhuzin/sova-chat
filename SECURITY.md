# Security

Sova is under active development. Security fixes target the latest code on `main`;
there is currently no long-term support policy for older releases.

Do not post credentials, private conversations, or exploitable vulnerabilities
in public issues. Use the repository's **Security > Report a vulnerability**
option when private reporting is enabled. If it is unavailable, open an issue
requesting a private contact channel without disclosing vulnerability details.

Include the affected version, reproduction steps using synthetic data, impact,
and any proposed fix in the private report. Never test another installation
without its owner's permission.

## Deployment

Keep `.env`, signing keys, backups, logs, and attachment storage private. Generate
independent application secrets, restrict database and Redis access, and serve
the application over HTTPS. See [deployment](docs/DEPLOY.md).

The public channel ID is an identifier, not a credential. User identity tokens
must be signed by the integrating backend; channel secrets must never be shipped
in a website or Android app. New integrations must enforce their own authorization boundaries.
