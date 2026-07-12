---
name: pi-documentation
description: Consult the installed Pi documentation and examples. Use when the user asks about Pi itself, its SDK, extensions, themes, skills, prompt templates, TUI, keybindings, providers, models, packages, or configuration.
---

# Pi documentation

Use the documentation from the installed Pi package as the source of truth.

## Locate the package

Resolve the package root from the active `pi` executable:

```bash
PI_PACKAGE_ROOT="$(dirname "$(dirname "$(realpath "$(command -v pi)")")")"
```

The main references are:

- `$PI_PACKAGE_ROOT/README.md`
- `$PI_PACKAGE_ROOT/docs/`
- `$PI_PACKAGE_ROOT/examples/`

Do not resolve `docs/...` or `examples/...` against the current project.

## Find the relevant documentation

Start with `README.md`, then read the topic-specific document and relevant examples:

- Extensions: `docs/extensions.md` and `examples/extensions/`
- Themes: `docs/themes.md`
- Skills: `docs/skills.md`
- Prompt templates: `docs/prompt-templates.md`
- Terminal user interface components: `docs/tui.md`
- Keybindings: `docs/keybindings.md`
- Software development kit integrations: `docs/sdk.md` and `examples/sdk/`
- Custom providers: `docs/custom-provider.md`
- Models: `docs/models.md`
- Packages: `docs/packages.md`

Read relevant Markdown files completely before implementing. Follow their cross-references when those references affect the task. Inspect examples for the API or extension point being changed.

Use exact API names and behavior from the installed version. Distinguish documented behavior from recommendations or inference.
