---
type: topic
title: LangChain
created: 2026-04-18
updated: 2026-10-04
sources:
  - url: https://github.com/marcusrbrown/gpt/blob/129b109d2783c67289a2ee3d64cf385698e79a16/package.json
    sha: 129b109d2783c67289a2ee3d64cf385698e79a16
    accessed: 2026-10-04
tags: [langchain, llm, ai, python, typescript]
related:
  - marcusrbrown--copiloting
  - marcusrbrown--gpt
---

# LangChain

LLM application framework available in Python and TypeScript. Used across the Fro Bot ecosystem for AI copilot experiments and retrieval-augmented generation.

## Repos Using LangChain

- [[marcusrbrown--copiloting]] — Polyglot monorepo with LangChain-based tutorials (TS), course sections (Python), and a Flask + SvelteKit PDF chat app using LangChain chains, retrievers, memory, and embeddings.
- [[marcusrbrown--gpt]] — Production React 19 app on the modern LangChain.js 1.x line (`langchain` 1.5.4, `@langchain/core` 1.2.4, `@langchain/openai` 1.5.5, `@langchain/anthropic` 1.5.3, `@langchain/langgraph` 1.4.7 as of 2026-08-08; was `langchain` 1.5.2 / `@langchain/core` 1.2.1 on 2026-06-30, `langchain` 1.4.4 / `@langchain/core` 1.1.48 on 2026-06-08 — steady 1.5.x minor tracking). All LangChain access is gated through a `BaseLLMProvider` abstraction — UI code never imports LangChain or LLM SDKs directly. Renovate groups the entire `langchain-ai/langchainjs` monorepo into a single `langchainjs-monorepo` PR and automerges unstable minor/patch updates of `@langchain/**` and `langchain`.

## Version Notes

### Python

In [[marcusrbrown--copiloting]], the Python side uses `langchain ^1.2` with `langchain-openai ^1.1` and `langchain-community >=0.3,<1.0`. This is the post-0.2 modular package structure where provider-specific integrations live in separate packages (e.g., `langchain-openai`).

**Known issue:** Application code still uses pre-0.2 import paths (e.g., `from langchain.chat_models import ChatOpenAI` instead of `from langchain_openai import ChatOpenAI`). The Fro Bot autoheal workflow is progressively migrating these.

### TypeScript/JavaScript

The root `package.json` in [[marcusrbrown--copiloting]] pins `langchain` at `0.0.212` — a very early version. The `tutorials/quickstart-llms.ts` script uses this. This version predates the modular restructuring and may have significantly different APIs from the Python side.

By contrast, [[marcusrbrown--gpt]] is the ecosystem's reference point for the **modern LangChain.js 1.x line**: `langchain` 1.5.2 with split `@langchain/core`, `@langchain/openai`, `@langchain/anthropic`, and `@langchain/langgraph` packages (as of 2026-06-30, tracking the 1.5.x minor line via grouped Renovate automerges). The two TS consumers are ~5 major-version generations apart — copiloting still demonstrates the pre-modular API while gpt runs the post-split modular architecture. Migration paths from `0.0.x` to `1.x` are non-trivial and not yet attempted in copiloting.

## GPT package-family snapshot (2026-10-04)

The manifest at `129b109d2783c67289a2ee3d64cf385698e79a16` in [[marcusrbrown--gpt]] declares `langchain` **1.5.15**, `@langchain/core` **1.2.14**, `@langchain/openai` **1.6.1**, `@langchain/anthropic` **1.5.11**, and `@langchain/langgraph` **1.4.7**. These supersede the August version snapshot above; the OpenAI integration has crossed into the 1.6 minor line while LangGraph retains its older pin. Package-family members need not have matching minor versions. This manifest establishes declared dependencies, not installed resolution, runtime interoperability, or the current updater suppression state. The provider abstraction remains README-described; application imports were outside the survey's permitted reads.

## Migration Patterns

The langchain 0.2+ migration requires changing import paths from the monolithic `langchain` package to provider-specific packages:

| Old import                                          | New import                                      |
| --------------------------------------------------- | ----------------------------------------------- |
| `from langchain.chat_models import ChatOpenAI`      | `from langchain_openai import ChatOpenAI`       |
| `from langchain.llms import OpenAI`                 | `from langchain_openai import OpenAI`           |
| `from langchain.embeddings import OpenAIEmbeddings` | `from langchain_openai import OpenAIEmbeddings` |
