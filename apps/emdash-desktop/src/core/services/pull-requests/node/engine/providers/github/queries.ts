export const PR_SUMMARY_FRAGMENT = `
  fragment PrSummaryFields on PullRequest {
    number
    title
    url
    state
    isDraft
    createdAt
    updatedAt
    headRefName
    headRefOid
    baseRefName
    baseRefOid
    commitCount: commits { totalCount }
    body
    additions
    deletions
    changedFiles
    mergeable
    mergeStateStatus
    statusCheckRollup { state }
    author {
      login avatarUrl url
      ... on User { databaseId createdAt updatedAt }
    }
    headRepository {
      nameWithOwner
      url
      owner { login }
    }
    baseRepository { url }
    labels(first: 100) { pageInfo { hasNextPage endCursor } nodes { name color } }
    assignees(first: 100) {
      pageInfo { hasNextPage endCursor }
      nodes {
        login avatarUrl url
        ... on User { databaseId createdAt updatedAt }
      }
    }
    reviewDecision
  }
`;

export const OPEN_PRS_QUERY = `
  query openPullRequests($owner: String!, $repo: String!, $cursor: String) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      pullRequests(states: OPEN, first: 50, after: $cursor, orderBy: { field: CREATED_AT, direction: ASC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ...PrSummaryFields }
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const PR_COLLECTIONS_QUERY = `
  query pullRequestCollections($owner: String!, $repo: String!, $number: Int!, $labelsCursor: String, $assigneesCursor: String) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        labels(first: 100, after: $labelsCursor) { pageInfo { hasNextPage endCursor } nodes { name color } }
        assignees(first: 100, after: $assigneesCursor) {
          pageInfo { hasNextPage endCursor }
          nodes { login avatarUrl url ... on User { databaseId createdAt updatedAt } }
        }
      }
    }
  }
`;

export const SYNC_PRS_QUERY = `
  query syncPullRequests($owner: String!, $repo: String!, $cursor: String) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      pullRequests(first: 25, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PrSummaryFields }
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_BY_NUMBER_QUERY = `
  query getPullRequestByNumber($owner: String!, $repo: String!, $number: Int!) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) { ...PrSummaryFields }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_CHECK_RUNS_BY_URL_QUERY = `
  query getPrCheckRunsByUrl($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    rateLimit { cost remaining resetAt }
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                contexts(first: 100, after: $cursor) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    ... on CheckRun {
                      __typename
                      name
                      status
                      conclusion
                      detailsUrl
                      startedAt
                      completedAt
                      checkSuite {
                        app { name logoUrl }
                        workflowRun { workflow { name } }
                      }
                    }
                    ... on StatusContext {
                      __typename
                      context
                      state
                      targetUrl
                      createdAt
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;
