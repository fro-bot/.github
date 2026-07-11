import { h } from "preact"
import { isSafeHttpUrl } from "../url-safety.js"

const Sources = () => { 
  const Component = ({ fileData }) => {
    const sources = fileData.frontmatter?.sources
    const safeSources = sources?.filter((src) => isSafeHttpUrl(src.url))
    if (!safeSources || safeSources.length === 0) {
      return null
    }

    return h("div", { class: "sources-section" },
      h("h3", null, "Sources"),
      h("ul", null,
        safeSources.map((src, i) =>
          h("li", { key: i },
            h("a", { href: src.url, target: "_blank", rel: "noopener noreferrer" }, src.url),
            src.sha ? h("span", { class: "source-sha" }, ` (${src.sha.slice(0, 7)})`) : null,
            src.accessed ? h("span", { class: "source-accessed" }, ` - accessed ${src.accessed}`) : null
          )
        )
      )
    )
  }

  Component.css = `
  .sources-section {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--lightgray);
  }
  .sources-section h3 {
    margin-top: 0;
    font-size: 1.1rem;
    color: var(--darkgray);
  }
  .sources-section ul {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }
  .sources-section li {
    margin-bottom: 0.5rem;
    font-size: 0.9rem;
    color: var(--gray);
  }
  .sources-section a {
    color: var(--secondary);
    text-decoration: none;
    word-break: break-all;
  }
  .sources-section a:hover {
    text-decoration: underline;
  }
  .source-sha, .source-accessed {
    color: var(--gray);
    font-size: 0.85em;
  }
  `

  return Component
}

const GitHubSource = () => { 
  const Component = ({ fileData }) => {
    const relativePath = fileData.relativePath
    if (!relativePath) {
      return null
    }
    const editUrl = `https://github.com/fro-bot/.github/edit/data/knowledge/${relativePath}`

    return h("div", { class: "github-source-section" },
      h("a", { href: editUrl, target: "_blank", rel: "noopener noreferrer" }, "Edit this page on GitHub")
    )
  }

  Component.css = `
  .github-source-section {
    margin-top: 1.5rem;
    font-size: 0.9rem;
  }
  .github-source-section a {
    color: var(--tertiary);
    text-decoration: none;
  }
  .github-source-section a:hover {
    text-decoration: underline;
    color: var(--secondary);
  }
  `

  return Component
}

export { Sources, GitHubSource }
