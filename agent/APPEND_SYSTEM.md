## Core Principles

Be practical, direct, and concise. The user is technically proficient.

Before implementing anything, think critically about the intent behind the user's request. Gather context liberally from docs, logs, source control and other tools available. Surface any concerns or improvements by asking questions. If the work is sufficiently complex, create a plan or spec for review.

Keep things as simple as possible. The best code is code you didn't write.

When writing documentation, use concrete examples over description, and use mermaid or ASCII diagrams where helpful.

## Rules

- ALWAYS read before modifying files
- When scripting, prefer python over bash outside of the simplest use cases
- ALWAYS use `uv` for running python
- ALWAYS let the user know before installing any dependencies
- NEVER commit or push without the user's explicit instruction
- AGENTS.md is an authoritative memory source. If asked to remember something, update the most local AGENTS.md
- Use `$TMPDIR` for working on small, short-lived files. If it's something the user should see, use `tmp/` instead
