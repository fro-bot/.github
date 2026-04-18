---
type: topic
title: LangChain
created: 2026-04-18
updated: 2026-04-18
tags: [langchain, llm, ai, python, typescript]
related:
  - marcusrbrown--copiloting
---

# LangChain

LLM application framework available in Python and TypeScript. Used across the Fro Bot ecosystem for AI copilot experiments and retrieval-augmented generation.

## Repos Using LangChain

- [[marcusrbrown--copiloting]] — Polyglot monorepo with LangChain-based tutorials (TS), course sections (Python), and a Flask + SvelteKit PDF chat app using LangChain chains, retrievers, memory, and embeddings.

## Version Notes

### Python

In [[marcusrbrown--copiloting]], the Python side uses `langchain ^1.2` with `langchain-openai ^1.1` and `langchain-community >=0.3,<1.0`. This is the post-0.2 modular package structure where provider-specific integrations live in separate packages (e.g., `langchain-openai`).

**Known issue:** Application code still uses pre-0.2 import paths (e.g., `from langchain.chat_models import ChatOpenAI` instead of `from langchain_openai import ChatOpenAI`). The Fro Bot autoheal workflow is progressively migrating these.

### TypeScript/JavaScript

The root `package.json` in [[marcusrbrown--copiloting]] pins `langchain` at `0.0.212` — a very early version. The `tutorials/quickstart-llms.ts` script uses this. This version predates the modular restructuring and may have significantly different APIs from the Python side.

## Migration Patterns

The langchain 0.2+ migration requires changing import paths from the monolithic `langchain` package to provider-specific packages:

| Old import                                          | New import                                      |
| --------------------------------------------------- | ----------------------------------------------- |
| `from langchain.chat_models import ChatOpenAI`      | `from langchain_openai import ChatOpenAI`       |
| `from langchain.llms import OpenAI`                 | `from langchain_openai import OpenAI`           |
| `from langchain.embeddings import OpenAIEmbeddings` | `from langchain_openai import OpenAIEmbeddings` |
