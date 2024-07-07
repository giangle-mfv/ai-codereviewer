/**
 * Interface representing the details of a pull request.
 */
export interface PRDetails {
    owner: string;
    repo: string;
    pull_number: number;
    title: string;
    description: string;
}

/**
 * Interface representing a comment to be posted on a pull request.
 */
export interface PRComment {
    body: string;
    path: string;
    line: number;
}

/**
 * Interface representing the response from the OpenAI API.
 */
export interface AIResponse {
    lineNumber: string;
    reviewComment: string;
}