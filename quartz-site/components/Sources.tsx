import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"
import { isSafeHttpUrl } from "./url-safety"

export default (() => {
  const Sources: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const sources = fileData.frontmatter?.sources as Array<{ url: string; sha?: string; accessed?: string }> | undefined
    const safeSources = sources?.filter((src) => isSafeHttpUrl(src.url))
    if (!safeSources || safeSources.length === 0) {
      return null
    }

    return (
      <div class="sources-section">
        <h3>Sources</h3>
        <ul>
          {safeSources.map((src, i) => (
            <li key={i}>
              <a href={src.url} target="_blank" rel="noopener noreferrer">
                {src.url}
              </a>
              {src.sha && <span class="source-sha"> ({src.sha.slice(0, 7)})</span>}
              {src.accessed && <span class="source-accessed"> - accessed {src.accessed}</span>}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  Sources.css = `
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

  return Sources
}) satisfies QuartzComponentConstructor
