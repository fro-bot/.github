import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

export default (() => {
  const GitHubSource: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const relativePath = fileData.relativePath
    if (!relativePath) {
      return null
    }

    const editUrl = `https://github.com/fro-bot/.github/edit/data/knowledge/${relativePath}`

    return (
      <div class="github-source-section">
        <a href={editUrl} target="_blank" rel="noopener noreferrer">
          Edit this page on GitHub
        </a>
      </div>
    )
  }

  GitHubSource.css = `
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

  return GitHubSource
}) satisfies QuartzComponentConstructor
