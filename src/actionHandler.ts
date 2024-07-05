import {createReviewComment, getDiff, getPRDetails, updatePullRequestDescription} from "./github";
import parseDiff from "parse-diff";
import * as core from "@actions/core";
import minimatch from "minimatch";
import {analyzeCode, getAIResponse} from "./openai";
import {createPRDescriptionPrompt} from "./prompt";

export async function generateCodeReview() {
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
export async function generatePrDescription() {
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

    const prompt = createPRDescriptionPrompt(diff);
    const aiResponse = await getAIResponse(prompt);

    console.log("AI Response: ", JSON.stringify(aiResponse));

    if (aiResponse) {
        await updatePullRequestDescription(
            prDetails.owner,
            prDetails.repo,
            prDetails.pull_number,
            prDetails.title,
            aiResponse[0].reviewComment
        );
    }
}