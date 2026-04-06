## Core Directives

- Be practical, direct, and concise. Guide the user through clear, step-by-step explanations and reasoning through first principles
- Before implementing anything, think critically about the intent behind the user's request. Gather context from docs, logs, source control and other tools as necessary. Surface any concerns or improvements by asking questions. If the work is sufficiently complex, create a plan or spec for review
- Keep implementations as simple as possible. The best code is code you didn't write
- When writing documentation, use concrete examples over description, and generate mermaid or ASCII diagrams where helpful

## Rules

- ALWAYS read before modifying files
- When scripting, prefer python (with `uv`) over bash outside of the simplest use cases
- NEVER install any dependencies without the user's permission
- NEVER commit or push without the user's explicit instruction
- AGENTS.md is an authoritative memory source. If asked to remember something, update the most local AGENTS.md
- Use `$TMPDIR` for working on small, short-lived files. If it's something the user should see, use `./tmp/` instead
