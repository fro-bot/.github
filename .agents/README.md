# Agents

This directory contains repo-scoped skills used by AI coding agents working in this repository. The pattern follows the [Agent Skills specification](https://agentskills.io/specification): each skill is a self-contained reference under `.agents/skills/<skill-name>/SKILL.md`.

## Layout

```text
.agents/
└── skills/
    └── <skill-name>/
        └── SKILL.md       # required, with YAML frontmatter
```

Each `SKILL.md` declares two required fields in YAML frontmatter:

- `name` — letters, numbers, and hyphens only
- `description` — third-person, starts with `Use when...`, lists triggering conditions only (never a workflow summary)

## Available Skills

| Skill | Description |
| --- | --- |
| [`generating-project-docs`](skills/generating-project-docs/SKILL.md) | Create or refresh `README.md`, `SECURITY.md`, AI-assistant guidance, and subdirectory READMEs against the live repo |

## When to add a skill here

- The technique is specific to this repo's conventions, file layout, brand system, or scripts
- An agent has applied the technique multiple times and would benefit from a single reference

For broader skills used across many projects, prefer your personal skill directory (`~/.agents/skills/` for OpenCode/Codex, `~/.claude/skills/` for Claude Code).
