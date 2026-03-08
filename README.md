# AI Code Reviewer

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-AI%20Code%20Reviewer-blue?logo=github)](https://github.com/marketplace/actions/ai-code-reviewer)

AI-powered code review for your pull requests using Claude. Catches bugs, security issues, and logic errors automatically.

## Quick Start

```yaml
# .github/workflows/ai-review.yml
name: AI Code Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: avatrix1/ai-code-reviewer@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## What It Reviews

- **Bugs** — logic errors, off-by-one, null references
- **Security** — injection, auth issues, exposed secrets (OWASP top 10)
- **Performance** — N+1 queries, unnecessary allocations, blocking calls
- **Clarity** — confusing logic that hurts maintainability

It skips style nitpicks and formatting opinions. Only comments on things that matter.

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `anthropic_api_key` | Your Anthropic API key | Yes | — |
| `github_token` | GitHub token for posting comments | No | `${{ github.token }}` |
| `model` | Claude model to use | No | `claude-sonnet-4-20250514` |
| `max_files` | Max files to review per PR | No | `15` |

## How It Works

1. Triggered on PR open or update
2. Fetches the diff for changed files
3. Sends the diff to Claude for review
4. Posts inline review comments on the PR

## Example Output

The action posts inline comments directly on the relevant lines of your PR, just like a human reviewer would.

For clean PRs, it posts a single comment: "Code looks good! No significant issues found."

## License

MIT
