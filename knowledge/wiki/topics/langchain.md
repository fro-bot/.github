---
type: topic
title: LangChain
created: 2026-04-18
updated: 2026-04-18
tags: [langchain, llm, ai, python, typescript, openai]
related:
  - marcusrbrown--copiloting
---

# LangChain

Framework for building LLM-powered applications. Available in both Python and TypeScript/JavaScript. Core technology in Marcus's AI experimentation work.

## Repos Using LangChain

- [[marcusrbrown--copiloting]] — Polyglot AI/LLM experimentation monorepo with LangChain-based copilot experiments, chains, agents, and a PDF chat app

## Version Landscape (as observed)

### Python

The `copiloting` repo uses the modern LangChain ecosystem split:

- `langchain ^1.2` — Core orchestration
- `langchain-openai ^1.1` — OpenAI-specific integrations (extracted from `langchain.chat_models`)
- `langchain-community >=0.3` — Community integrations

**Migration note:** LangChain Python underwent a major restructuring. Imports like `from langchain.chat_models import ChatOpenAI` moved to `from langchain_openai import ChatOpenAI`. The copiloting repo has upgraded deps but application code still uses old import paths in some files (progressive migration ongoing via autoheal).

### TypeScript/JavaScript

The `copiloting` repo root `package.json` pins `langchain: "0.0.212"` — a very old version of the JS SDK. The TypeScript tutorials workspace may have its own version. The JS SDK has also undergone major restructuring since 0.0.x.

## Integration Patterns Observed

### Chain-based Architecture

`course/sections/` demonstrates chain composition (agents, chains, facts/embeddings, chat) as separate Poetry-exposed CLI scripts.

### RAG (Retrieval-Augmented Generation)

The PDF chat app (`course/pdf-dist/`) implements a full RAG pipeline: document upload → embedding generation → vector storage (Pinecone) → retrieval → LLM response. Uses Flask + Celery for async processing.

### Agent Patterns

`course/sections/agents/` implements LangChain agent demos.

## Related Technologies

- **OpenAI** — Primary LLM provider (openai ^2.0 Python SDK)
- **Pinecone** — Vector database for embeddings/retrieval
- **Tiktoken** — OpenAI's BPE tokenizer for token counting
- **Celery + Redis** — Async task processing for the PDF chat app
- **Pydantic** — Data validation (v2) for structured LLM outputs
