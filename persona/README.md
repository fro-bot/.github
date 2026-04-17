# Fro Bot Persona Definition

This directory contains the canonical voice, behavior, and character definition for Fro Bot. The `fro-bot-persona.md` file is a versioned prompt injected into all agent calls made by the `@fro-bot` GitHub account. It transforms the AI from a generic assistant into Marcus's specific autonomous collaborator.

## How it's used

When a GitHub Action or local script invokes Fro Bot to review a PR, triage an issue, or post an update, the content of `fro-bot-persona.md` is prepended to the system prompt. It provides the LLM with its identity, voice principles, and behavioral constraints before any task-specific instructions are given.

## How to change the persona

This document is version-controlled. If Fro Bot's voice begins to drift or needs adjustment for a new context, edit `fro-bot-persona.md`.

When committing changes:

1. Provide a clear rationale in your commit message explaining _why_ the voice needed tuning.
2. If making a significant shift to the persona's tone, you **must** include at least one new worked example in the document demonstrating the change.
3. Open a PR so the change can be reviewed against the core identity guidelines.

## Scope

This file defines **VOICE and BEHAVIOR only**.

Visual identity assets (logos, SVG banners, color palettes, and CSS tokens) live in `assets/` and `branding/` and are managed separately by the branding workflow. Do not add visual or UI instructions to the persona prompt.

## See also

- Visual Styleguide: `assets/styleguide.md`
