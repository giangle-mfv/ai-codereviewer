import {Chunk, File} from "parse-diff";
import { PRDetails } from './types';

export function createCodeReviewPrompt(file: File, chunk: Chunk, prDetails: PRDetails): string {
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

export function createPRDescriptionPrompt(diff: string): string {
    return `
  Your job is reading the following git diff and suggest me a description of the Pull Request. 
  The description should be summary of what i've done, what is the output and what can be the impact to the existing code base.
  
  Git diff are:
  ---
  ${diff}
  ---
  `;
}