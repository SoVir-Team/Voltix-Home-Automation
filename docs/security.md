# Security

What protects whom, and what is left to the operator.

## Threats considered

| Threat                                        | Control                                                                                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Someone forges or replays commands to a board | TLS; every message HMAC-signed over its exact bytes; 60 s freshness window; per-direction replyToken replay guard on both ends                                                                              |
| A stolen board secret                         | Secrets are per board, not per account: a leak exposes one board only. Regenerating the secret in the app disconnects it (close 4002)                                                                       |
| Database leak                                 | Passwords: argon2id. Board secrets: AES-256-GCM with `SECRET_ENC_KEY`, which is kept out of the database. API keys and refresh tokens: stored only as SHA-256 hashes                                        |
| Account takeover by password guessing         | Rate limits (10/min on auth routes), login attempt window, uniform error messages                                                                                                                           |
| Session theft                                 | 15 min access JWT + 30-day refresh token in httpOnly, Secure, SameSite=Lax cookies. Refresh tokens rotate; reusing an old one revokes the whole family. Users can see and revoke sessions                   |
| CSRF                                          | State-changing browser requests must carry the web app's `Origin` (cookie auth). API keys use `Authorization: Bearer`, so CSRF doesn't apply to them                                                        |
| A member seeing or controlling another home   | Every home route checks membership and role (owner/admin/member). Non-members get 404 so homes can't be probed. Owners set per-area permissions for plain members (locks & garage doors, lighting, climate) |
| An integration key doing too much             | API keys carry scopes (`homes:read`, `devices:read`, `devices:control`, `scenes:run`), can expire, are refused on every other route, and never have platform-admin rights                                   |
| Malicious firmware pushed to boards           | Only platform admins upload firmware. Download links are one-time and expire in 15 min. Boards verify size and SHA-256 before installing, and roll back if the new image can't reach the cloud              |
| Oversized or malformed input                  | zod validation on every route and every WebSocket message; 8 KB device frames, 4 KB browser frames, 4 MB firmware uploads                                                                                   |
| Abuse by a misbehaving board                  | Per-device event token bucket, telemetry throttling, 10 invalid messages close the socket                                                                                                                   |
| Board setup secret sniffed over the air       | The setup Wi-Fi is open, but only while the portal runs (during setup, or 5 min after a failed Wi-Fi join). Regenerate the secret if setup happened somewhere untrusted                                     |

Every security-relevant action goes to `audit_log`, kept for one year: logins, password and session changes,
API keys, members and invites, board secrets, firmware and rollouts, admin changes. Platform admins see it
under Admin → Audit.

Logs redact authorization headers, cookies, passwords and secrets.

## Operator responsibilities

- Serve everything over HTTPS with a valid certificate. Boards trust Let's Encrypt roots by default.
- Set `COOKIE_SECURE=true` and a production `APP_ORIGIN` / `API_ORIGIN`.
- Generate `SECRET_ENC_KEY` once (32 random bytes, base64) and back it up **separately** from database
  backups. If it is lost, every board must be re-provisioned. If it leaks along with a backup, the board
  secrets are exposed.
- Generate the JWT signing key and VAPID keys once; keep `.env` readable only by the service user.
- Keep the database port closed to the internet.
- Rotate any credential that was ever shared in chat, email or a repository. The Wi-Fi password found in the
  old LAN firmware folder should be changed.

## Reporting a problem

Email the platform admin. Don't open a public issue for vulnerabilities.
