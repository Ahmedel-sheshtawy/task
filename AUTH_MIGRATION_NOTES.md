# Authentication compatibility notes

The supplied education platform uses PBKDF2 with SHA-256, 100,000 iterations, a random 16-byte salt, and a 256-bit derived key. This project implements the same derivation parameters and URL-safe Base64 encoding.

The education platform's table and account model are not copied. The clean platform uses its own `users` and `auth_sessions` tables, with `password_hash` and `password_salt` stored separately. This is a deliberate adaptation of the working credential algorithm, not a database-schema transplant.

For a clean installation, apply migrations `0001` through `0003` to the newly created D1 database before accepting registrations.
