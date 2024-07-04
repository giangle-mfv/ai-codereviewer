import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const REVIEW_LABEL = 'ai-review';
const PR_DESC_LABEL = 'ai-pr-desc';
const LABELED_ACTION = 'labeled';

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

async function getPRDetails(): Promise<PRDetails> {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

async function getDiff(
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
}

async function analyzeCode(
  parsedDiff: File[],
  prDetails: PRDetails
): Promise<Array<{ body: string; path: string; line: number }>> {
  const comments: Array<{ body: string; path: string; line: number }> = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    for (const chunk of file.chunks) {
      const prompt = createCodeReviewPrompt(file, chunk, prDetails);
      const aiResponse = await getAIResponse(prompt);
      if (aiResponse) {
        const newComments = createComment(file, chunk, aiResponse);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }
  return comments;
}

function createCodeReviewPrompt(file: File, chunk: Chunk, prDetails: PRDetails): string {
  return `Your task is to review pull requests. Instructions:
- Provide the response in following JSON format:  {"reviews": [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- IMPORTANT: NEVER suggest adding comments to the code.

Review the following code diff in the file "${
    file.to
  }" and take the pull request title and description into account when writing the response.
  
Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
  // @ts-expect-error - ln and ln2 exists where needed
  .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
  .join("\n")}
\`\`\`
`;
}

function createPRDescriptionPrompt(diff: string, prDetails: PRDetails): string {
  return `
  Your job is reading the following git diff and suggest me a description of the Pull Request. 
  The description should be summary of what i've done, what is the output and what can be the impact to the existing code base.
  
  Pull request title: ${prDetails.title}
  Pull request description:
  ---
  ${prDetails.description}
  ---

  Git diff are:
  ---
  ${diff}
  ---
  `;
}

async function getAIResponse(prompt: string): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> {
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.2,
    max_tokens: 700,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };

  try {
    const response = await openai.chat.completions.create({
      ...queryConfig,
      // return JSON if the model supports it:
      ...(OPENAI_API_MODEL === "gpt-4-1106-preview"
        ? { response_format: { type: "json_object" } }
        : {}),
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    });

    const res = response.choices[0].message?.content?.trim() || "{}";
    return JSON.parse(res).reviews;
  } catch (error) {
    console.error("Error:", error);
    return null;
  }
}

function createComment(
  file: File,
  chunk: Chunk,
  aiResponses: Array<{
    lineNumber: string;
    reviewComment: string;
  }>
): Array<{ body: string; path: string; line: number }> {
  return aiResponses.flatMap((aiResponse) => {
    if (!file.to) {
      return [];
    }
    return {
      body: aiResponse.reviewComment,
      path: file.to,
      line: Number(aiResponse.lineNumber),
    };
  });
}

async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: "COMMENT",
  });
}

async function updatePullRequestDescription(
    owner: string,
    repo: string,
    pull_number: number,
    title: string,
    body: string
) {
  await octokit.pulls.update({
    owner,
    repo,
    pull_number,
    title,
    body
  });
}

async function main() {
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  if (!eventData.action || eventData.action !== LABELED_ACTION) {
    console.log("Unsupported action:", eventData.action ?? "none");
  }

  if (eventData.label.name && eventData.label.name !== REVIEW_LABEL && eventData.label.name !== PR_DESC_LABEL) {
    console.log("Unsupported label:", eventData.label.name);
  }

  if (eventData.label.name === REVIEW_LABEL) {
    await generateCodeReview();
  }

  if (eventData.label.name === PR_DESC_LABEL) {
    await generatePrDescription();
  }
}

async function generateCodeReview() {
  const prDetails = await getPRDetails();
  let diff: string | null;

  diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
  );

  if (!diff) {
    console.log("No diff found");
    return;
  }

  const parsedDiff = parseDiff(diff);

  const excludePatterns = core
      .getInput("exclude")
      .split(",")
      .map((s) => s.trim());

  const filteredDiff = parsedDiff.filter((file) => {
    return !excludePatterns.some((pattern) =>
        minimatch(file.to ?? "", pattern)
    );
  });

  const comments = await analyzeCode(filteredDiff, prDetails);
  if (comments.length > 0) {
    await createReviewComment(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number,
        comments
    );
  }
}
async function generatePrDescription() {
  const prDetails = await getPRDetails();
  let diff: string | null;

  diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
  );

  if (!diff) {
    console.log("No diff found");
    return;
  }

  const prompt = createPRDescriptionPrompt(diff, prDetails);
  const aiResponse = await getAIResponse(prompt);

  console.log("AI Response: ", aiResponse);

  // if (aiResponse) {
  //     await updatePullRequestDescription(
  //         prDetails.owner,
  //         prDetails.repo,
  //         prDetails.pull_number,
  //         prDetails.title,
  //         aiResponse[0].reviewComment
  //     );
  // }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
