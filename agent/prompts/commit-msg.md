---
description: Draft a commit message for staged changes
---
Review the staged changes (`git diff --cached`) and draft a commit message.

Format:
- Subject line: `<scope>: <summary>` (imperative, ≤72 chars)
- Blank line, then bullet points grouped by logical area if needed
- Hard-wrap body lines at 72 chars with 2-space continuation indent

Style rules:
- One bullet per logical change — no parenthetical implementation details
- Summarise a class of changes rather than enumerating every file affected
- Omit redundant labels obvious from context (e.g. "new file", "rename")
- Describe intent, not structure

Output the commit message only, inside a code block.
