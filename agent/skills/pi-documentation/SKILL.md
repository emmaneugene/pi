---
name: pi-documentation
description: Consult the documentation, examples, and public API declarations bundled with the active Pi installation. Use whenever a task concerns Pi itself, including its CLI, configuration, resources, extension APIs, SDK, TUI, providers, sessions, or other current and future Pi features.
disable-model-invocation: false
---

# Pi documentation

Use artifacts bundled with the active Pi installation as the source of truth. Do not assume that documentation in the current project describes the installed Pi version.

## Locate the active installation

1. If `PI_PACKAGE_DIR` names an existing directory, use it.
2. Otherwise, resolve the active `pi` executable. Account for symlinks, package-manager wrappers, source execution, and compiled binaries. Walk upward from its real path to find the Pi package root instead of assuming a fixed path such as `<package>/dist/cli.js`.
3. Verify the discovered root using its `package.json` and bundled Pi assets. For a compiled binary, also inspect the executable's directory for those assets.
4. Verify each path before reading it. If the installed distribution omits its documentation, report that limitation instead of silently consulting a different Pi version.

Bundled references may include:

- `README.md`
- `docs/`
- `examples/`
- `package.json`
- public declarations under `dist/**/*.d.ts`

Resolve these paths against the active installation, never against the current project.

## Find relevant material

Inspect the installed documentation structure instead of relying on a fixed topic-to-file map:

1. Use `docs/index.md`, `docs/docs.json`, the root `README.md`, and directory listings when available to identify relevant documents.
2. Read the relevant Markdown documents completely before implementing.
3. Follow cross-references that affect the task.
4. Inspect relevant examples for the API or extension point being changed.
5. If a referenced source file is not bundled, or exact signatures matter, inspect the installed public type declarations and implementation.
6. Prefer documentation and public declarations over implementation details. Distinguish documented behavior, observed implementation, and recommendations.

State the installed Pi package name and version when version differences could affect the answer. Use exact API names and behavior from that installed version.
