# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds:

- the user names and passwords of Kodi's web server, in the Gladys
  configuration (the passwords in `secret` fields, never sent back to the
  browser by Gladys) — never in `/data`, never in the logs;
- `/data/kodi-state.json`: the name each configured Kodi gives itself and
  whether the first automatic search on the network ran, no secret;
- network: HTTP(S) to the web server of the Kodi addresses entered or found
  on the network (JSON-RPC and artwork, Basic authentication), and a WebSocket
  to port 9090 of the same hosts, on the local network. No other outbound
  connection. Redirects are not followed, so a password is never sent to
  another address. The search on the network goes through the Gladys core
  (mDNS), the container sends no multicast.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Kodi itself (see its
[security policy](https://github.com/xbmc/xbmc/security/policy)). Note that
Kodi's port 9090 has no authentication: whoever reaches it controls Kodi.
