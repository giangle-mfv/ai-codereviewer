import {readFileSync} from "fs";
import { Octokit } from "@octokit/rest";
import {PRDetails} from "./types";
import * as core from "@actions/core";
import {Chunk, File} from "parse-diff";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const octokit = new Octokit({ auth: GITHUB_TOKEN });

export async function getPRDetails(): Promise<PRDetails> {
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

export async function getDiff(
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

export function createComment(
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

export async function createReviewComment(
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

export async function updatePullRequestDescription(
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