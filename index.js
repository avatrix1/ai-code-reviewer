const core = require("@actions/core");
const github = require("@actions/github");
const Anthropic = require("@anthropic-ai/sdk").default;

const FOOTER =
  "\n\n---\n*Powered by [Avatrix AI](https://api-service-wine.vercel.app) — [Get API access](https://api-service-wine.vercel.app)*";

async function run() {
  try {
    const context = github.context;
    if (!context.payload.pull_request) {
      core.info("Not a pull request event. Skipping.");
      return;
    }

    const apiKey = core.getInput("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      core.setFailed(
        "No Anthropic API key provided. Set anthropic_api_key input or ANTHROPIC_API_KEY env var."
      );
      return;
    }

    const githubToken = core.getInput("github_token");
    const model = core.getInput("model") || "claude-sonnet-4-20250514";
    const maxFiles = parseInt(core.getInput("max_files") || "15", 10);

    const octokit = github.getOctokit(githubToken);
    const anthropic = new Anthropic({ apiKey });

    const { owner, repo } = context.repo;
    const pullNumber = context.payload.pull_request.number;

    // Get the diff
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: maxFiles,
    });

    if (files.length === 0) {
      core.info("No files changed. Skipping review.");
      return;
    }

    // Build diff summary
    const diffParts = [];
    for (const file of files) {
      if (file.status === "removed") continue;
      const patch = file.patch;
      if (!patch) continue;
      diffParts.push(`## ${file.filename} (${file.status})\n\`\`\`diff\n${patch}\n\`\`\``);
    }

    const diffText = diffParts.join("\n\n");
    if (diffText.length === 0) {
      core.info("No reviewable diffs. Skipping.");
      return;
    }

    // Truncate if too large
    const truncatedDiff = diffText.length > 50000 ? diffText.slice(0, 50000) + "\n...(truncated)" : diffText;

    const prTitle = context.payload.pull_request.title;
    const prBody = context.payload.pull_request.body || "(no description)";

    const response = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are a senior software engineer reviewing a pull request.

PR Title: ${prTitle}
PR Description: ${prBody}

Diff:
${truncatedDiff}

Review this PR. Focus on:
1. Bugs and logic errors
2. Security issues (injection, auth, secrets, OWASP top 10)
3. Performance problems
4. Code clarity issues (only if they hurt maintainability)

Be concise. Skip nitpicks and style preferences. Only comment on things that matter.

Format your response as a JSON array of review comments:
[
  {
    "file": "path/to/file.ts",
    "line": 42,
    "body": "Your comment here"
  }
]

If the code looks good and you have no significant comments, return an empty array: []

Return ONLY the JSON array, no other text.`,
        },
      ],
    });

    const content = response.content[0]?.text || "[]";

    // Parse the review comments
    let comments;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      comments = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      core.warning("Failed to parse Claude response as JSON. Posting as general comment.");
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `## AI Code Review\n\n${content}${FOOTER}`,
      });
      return;
    }

    if (comments.length === 0) {
      // Post a summary comment saying the code looks good
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `## AI Code Review\n\nCode looks good! No significant issues found.${FOOTER}`,
      });
      core.info("No issues found. Posted approval comment.");
      return;
    }

    // Map changed files to their diff positions
    const filePatches = new Map();
    for (const file of files) {
      if (file.patch) {
        const lineToPosition = new Map();
        let position = 0;
        for (const line of file.patch.split("\n")) {
          position++;
          const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
          if (match) {
            // This is a hunk header — track the starting line
            let currentLine = parseInt(match[1], 10) - 1;
            const hunkLines = file.patch.split("\n").slice(position);
            for (let i = 0; i < hunkLines.length; i++) {
              const hLine = hunkLines[i];
              if (hLine.startsWith("@@")) break;
              if (!hLine.startsWith("-")) {
                currentLine++;
                lineToPosition.set(currentLine, position + i + 1);
              }
            }
          }
        }
        filePatches.set(file.filename, lineToPosition);
      }
    }

    // Post review comments
    const reviewComments = [];
    const generalComments = [];

    for (const comment of comments) {
      const lineMap = filePatches.get(comment.file);
      const position = lineMap?.get(comment.line);

      if (position) {
        reviewComments.push({
          path: comment.file,
          position,
          body: comment.body + FOOTER,
        });
      } else {
        generalComments.push(`**${comment.file}:${comment.line}** — ${comment.body}`);
      }
    }

    // Post inline comments as a review
    if (reviewComments.length > 0) {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        event: "COMMENT",
        comments: reviewComments,
      });
    }

    // Post any comments that couldn't be mapped to diff positions
    if (generalComments.length > 0) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `## AI Code Review\n\n${generalComments.join("\n\n")}${FOOTER}`,
      });
    }

    core.info(`Posted ${reviewComments.length} inline comments and ${generalComments.length} general comments.`);
  } catch (error) {
    core.setFailed(`AI Code Reviewer failed: ${error.message}`);
  }
}

run();
