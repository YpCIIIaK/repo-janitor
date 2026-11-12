# Educational companion reports

User-requested workflow, added 2026-11-12: for every approximately 100 newly scanned distinct repositories, produce a separate detailed educational report in addition to the ordinary scan summary. A final smaller batch also gets a companion. Include 2–3 useful cases even when no vulnerability is confirmed; never fabricate an observed finding to fill this quota.

Order the cases from simple to complex; build on earlier concepts and increase depth gradually across batches. Start with one-process/browser data flows, then cross-window/API trust, then multi-service state/authorization/queue chains as evidence permits.

Write in plain Russian for a junior frontend/fullstack developer. Explain unfamiliar terms at first use. Each case must include:

1. Repository, full pinned commit and source location, plus what the component actually does.
2. Explicit status: reproduced local behavior, conditional risk, false positive, or hypothetical teaching example. Mark hypothetical code as invented and distinct from observed code.
3. A Mermaid or equivalent diagram showing actors, browser/server/storage/queue as applicable, data direction and the trust boundary.
4. A step-by-step source → transformation/storage → sensitive operation chain. Explain who controls each input and which additional conditions an attacker would need.
5. What was actually verified and what remains unknown. Do not turn a dangerous API, fake secret, local demo, or low-confidence scanner hit into a confirmed production exploit.
6. A harmless local example, proposed mitigation and before/after validation where feasible. Explain why the mitigation changes the trust boundary, rather than merely hiding the warning.
7. A short takeaway or self-check exercise. Clarify how the scanner detects the general condition and which negatives it excludes.

Keep educational cases separate from confirmed finding counts, benchmark TP/FP labels, confidence calibration and score changes. Do not tune a scanner to match company/repository names. Add a deterministic regression fixture for each new generalized rule, including safe near-misses. Report exclusions and performance limits.

Prefer sharing an educational copy with the user locally. Before publishing named security research, distinguish it from a generic scanner PR and do not send reports/messages to third parties without explicit user instruction. First contact drafts should describe evidence and uncertainty honestly; employment interest must not be tied to withholding disclosure or remediation.

The next agent should read this file along with ROUTINE.md and WORKFLOW.md before a new scan cycle.
