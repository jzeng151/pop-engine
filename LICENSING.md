# Licensing

This repository holds two different kinds of work, and they are licensed differently on purpose.

## Source code: Apache License 2.0

Covered: `apps/`, `packages/`, `scripts/`, and the build, lint, and test configuration.

Full text in [`LICENSE`](LICENSE). You may use, modify, and redistribute it, including commercially, keeping the copyright notice and stating significant changes. Apache-2.0 was chosen over MIT for its explicit patent grant and its patent-retaliation clause, which matter once more than one person has contributed.

## Regulatory content: all rights reserved, pending a decision

**Not** covered by the Apache license:

| Path | What it is |
| --- | --- |
| `rules/` | the published NYC ruleset and its proposals |
| `docs/VERIFICATION-SOURCES.md` | the fetch-confirmed evidence record |
| `docs/test-scenario-answer-key.md` | the approved scenario fixtures |
| `docs/PRD.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`, `docs/ARCHITECTURE*.md` | product and architecture record |
| `specs/` | approved feature specifications |

These are reserved by the copyright holders while the team decides how to license them. If you want to use them, ask.

### Why they are separated

The engine is ordinary TypeScript. The ruleset is not. It is 42 rules and 4 advisories naming nine city and state agencies, where every regulatory fact traces through an evidence reference to a quote that was fetched and read on a recorded date, across eight verification rounds. `docs/ARCHITECTURE.md` states the position directly: the crown jewel is a versioned file.

Publishing the engine costs nothing and may help someone. Publishing the verified ruleset gives away the part that took the work, before the team has decided whether that is the intent. Splitting them keeps that decision open without holding the code hostage to it.

Note also that a permit dataset carries a duty the code does not: a stale or partial copy, republished without its verification record, can tell an organizer something false about the law. Keeping `rules/` and `docs/VERIFICATION-SOURCES.md` together and reserved is partly a correctness position, not only a commercial one.

## Regulatory content is not advice

The ruleset records what named primary sources were observed to publish on the dates in `docs/VERIFICATION-SOURCES.md`. It is not legal advice, not complete, and not a substitute for confirming a requirement with the issuing agency. Coverage limits are stated in the README under "What it does not do".

## Copyright holders

Naquan McKune, Jason Zeng, Adedoyin Ahoton, Bo Moldenhauer.

Absent a separate written agreement between them, this file records intent rather than settling ownership. If an institution has an IP claim on this work through a course or program, that claim takes precedence over this file and should be resolved before anyone relies on these terms.

## Contributing

Contributions to the source code are accepted under Apache-2.0 (Section 5: a contribution submitted for inclusion is licensed under the same terms, absent a separate agreement).

**Contributions to `rules/` or `docs/VERIFICATION-SOURCES.md` are different** and are not accepted from outside the team. Regulatory facts enter this repository only through the verification process in `docs/DOCUMENTATION-GOVERNANCE.md`, under the approvals in its change-class table. See `AGENTS.md` and `CONTRIBUTING.md`.
