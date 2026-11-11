# Erlang analysis

Erlang is a language and runtime for concurrent, fault-tolerant systems. BEAM processes communicate through messages; OTP supplies supervision and application patterns. A process is not a security sandbox: loaded code and connected distribution nodes must be trusted.

The default scan includes `erlang-security` and `erlang-build`. Runtime analysis covers production `.erl`, `.hrl` and `.escript` files; test, fixture, example, dependency and build output paths are excluded. Rebar analysis reads literal `rebar.config` and adjacent `rebar.lock` without executing target code, scripts, hooks or plugins.

## Rules

| Rule suffix | Checks |
| --- | --- |
| unsafe-term | `binary_to_term` without a known `[safe]` option; local encoding round trips excluded |
| dynamic-atom | Runtime creation of atoms; literal and existing-atom conversions excluded |
| shell | Dynamic shell commands, including explicit shell `-c` through `spawn_executable` |
| eval | Runtime Erlang expression evaluation |
| code-load | Dynamic BEAM binary loading |
| tainted-dispatch | External module/function selection or invocation of externally decoded functions |
| external-executable | External data selecting an executable |
| tls-verify-none | Explicitly disabled peer verification in client SSL/HTTP options |
| tls-accept-bad-cert | Literal verification callback accepting bad certificates |
| plugin-unversioned | Unversioned Rebar build plugins (informational) |
| dep-cleartext | Cleartext Git transport in the effective dependency declaration |
| dep-floating | Git dependencies lacking an immutable commit reference |

Rule names use the `erlang-` prefix. Proven external sources include selected Cowboy request APIs, socket receive results and network callback payloads. The lexer and local analysis account for function clauses, aliases, pattern bindings, branch and fun scopes, comprehensions, literal macros, import/BIF shadowing, and selected map/proplist operations. Literal allowlists and fixed executable argument vectors prevent common false positives. Default dependencies respect the effective lock entry; plugins and nondefault profiles cannot borrow its protection.

Unknown caller input produces low-confidence review items rather than a claim of remote exploitability. Trusted RPC dispatch alone is not a vulnerability. `[safe]` prevents new atom creation during term decoding; it does not validate application schemas, bound resource use or make invoking decoded functions safe. TLS server defaults are not treated as client verification failures.

This is conservative local static analysis, not a complete Erlang compiler or proof of safety. Arbitrary preprocessing, interprocedural flow, runtime configuration, scripts and deployment exposure require review. No guarantee that a repository contains a vulnerability is possible. New rules have regression fixtures, not a measured corpus precision claim.

## References

- [OTP secure coding](https://www.erlang.org/doc/system/secure_coding.html)
- [EEF atom exhaustion](https://security.erlef.org/secure_coding_and_deployment_hardening/atom_exhaustion.html)
- [OTP SSL hardening](https://www.erlang.org/doc/apps/ssl/ssl_hardening.html)
- [Rebar dependencies and lock files](https://rebar3.org/docs/configuration/dependencies/)
- [Rebar plugins](https://rebar3.org/docs/configuration/plugins/)
- [Rebar profiles](https://rebar3.org/docs/configuration/profiles/)
