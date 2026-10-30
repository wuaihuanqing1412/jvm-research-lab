# Security model

## Trust model

This project is a **research runtime**, not a sandbox.

Running a class file means executing arbitrary bytecode with the privileges of the surrounding page. There is no bytecode verifier, no capability system, and no process isolation. Treat every `.class` file as untrusted code.

## Browser boundary

The browser provides the real security boundary:

- no native syscalls
- no arbitrary filesystem access
- no raw sockets
- no dynamic library loading
- Web APIs are mediated by the page

The runtime does **not** add a second boundary inside JavaScript. A bug in a native bridge can expose whatever the page can already do.

## High-privilege modules

The following are explicitly experimental and must not be enabled by default in a hosted demo:

| Module | Risk | Default |
|--------|------|---------|
| `Unsafe` | bypasses constructors, writes fields by offset | lab only |
| `defineClass` | defines arbitrary classes at runtime | lab only |
| native bridges | JS functions with page privileges | allow-list only |
| file/network shims | string-level only; do not treat as real I/O | disabled in browser |
| `ServiceLoader` / module shims | bypasses normal service discovery | lab only |

There is no generic native bridge that accepts a path or code string from untrusted input. Bridges are explicit function tables.

## Hosting guidance

If you build a public playground:

1. Do not accept arbitrary uploaded `.class` files without a separate sandbox (for example an iframe on a distinct origin with network disabled).
2. Do not expose real filesystem or network primitives through native bridges.
3. Serve with a restrictive CSP; do not add `unsafe-eval` on the main origin.
4. Treat the runtime as a denial-of-service risk: infinite loops and huge allocations are possible.
5. Keep the high-privilege experiments in a separate origin or local-only build.

## Known limitations

- no bytecode verifier
- no memory limits
- no instruction-step limit in every harness
- no protection against malicious `invokedynamic` or reflection
- native shims may violate JDK invariants
- `Unsafe` offsets are not a real memory model

## Reporting

Please open a private security advisory or contact the maintainer before publishing a proof-of-concept that escapes the documented boundaries. See [`SECURITY.md`](../SECURITY.md).
