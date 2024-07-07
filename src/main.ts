import { readFileSync } from "fs";
import { generateCodeReview, generatePrDescription } from "./actionHandler";

const REVIEW_LABEL = 'ai-review';
const PR_DESC_LABEL = 'ai-pr-desc';
const LABELED_ACTION = 'labeled';

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

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
