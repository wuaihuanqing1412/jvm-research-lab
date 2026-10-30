# Security policy

JVM Research Lab executes untrusted bytecode by design. It is not a sandbox.

## Supported versions

The `main` branch is the only supported version during the research phase.

## Reporting a vulnerability

Please **do not** open a public issue for a vulnerability that allows:

- escaping the browser page boundary
- accessing local files or network resources not exposed by the page
- remote code execution outside the runtime
- bypassing the documented experimental-module boundaries

Instead, contact the maintainer privately (for example through the GitHub security advisory feature) with:

- a minimal class file or reproduction steps
- the browser and version
- the expected and actual behaviour

## Scope

In scope:

- runtime bugs that violate the documented browser boundary
- native bridge bugs that expose unexpected page capabilities
- denial-of-service issues that affect a hosted demo

Out of scope:

- executing arbitrary bytecode inside the runtime (that is the point)
- crashes caused by malformed class files
- missing Java SE compatibility
- issues in third-party ASM/Mixin/Guava/Gson/OpenJDK code

## Safe usage

- Do not run untrusted class files on an origin that holds credentials.
- Host the playground on an isolated origin.
- Keep `Unsafe`, `defineClass`, and native bridges disabled in public builds.
- Read [`docs/security-model.md`](docs/security-model.md).
