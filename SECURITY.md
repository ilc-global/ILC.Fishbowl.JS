# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it
privately rather than opening a public issue.

**How to report:**

1. **GitHub Security Advisory** (preferred) — Go to the
   [Security tab](../../security/advisories/new) of this repository and
   create a private security advisory.

2. **Email** — Contact us at security@israellopezconsulting.com with a
   description of the vulnerability, steps to reproduce, and any relevant
   Fishbowl Advanced version information.

We will acknowledge receipt within 3 business days and provide an initial
assessment within 10 business days.

## Scope

This policy covers the `fb.js` and `fishbowl.js` libraries in this
repository. Issues related to Fishbowl Advanced server software should be
reported directly to Fishbowl.

## Best Practices for Users

- Always use parameterized queries with `FB.query(sql, params)` — never
  concatenate user input into SQL strings.
- Validate and sanitize any user-supplied data before passing it to
  `FishbowlCSV` import builders.
- Keep your Fishbowl Advanced server updated to the latest supported version.
