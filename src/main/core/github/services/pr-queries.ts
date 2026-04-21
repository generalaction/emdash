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
    author {
      login avatarUrl url
      ... on User { databaseId createdAt updatedAt }
    }
    headRepository {
      nameWithOwner
      url
      owner { login }
    }
    baseRepository {
      url
    }
    labels(first: 10) { nodes { name color } }
    assignees(first: 10) {
      nodes {
        login avatarUrl url
        ... on User { databaseId createdAt updatedAt }
      }
    }
    reviewDecision
  }
`;

export const LIST_PRS_QUERY = `
  query listPullRequests($owner: String!, $repo: String!, $limit: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: OPEN, first: $limit, orderBy: { field: UPDATED_AT, direction: DESC }) {
        totalCount
        nodes { ...PrSummaryFields }
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const SEARCH_PRS_QUERY = `
  query searchPullRequests($searchQuery: String!, $limit: Int!) {
    search(query: $searchQuery, type: ISSUE, first: $limit) {
      issueCount
      nodes {
        ... on PullRequest { ...PrSummaryFields }
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_DETAIL_QUERY = `
  query getPullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        ...PrSummaryFields
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_CHECK_RUNS_QUERY = `
  query getPrCheckRuns($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        commits(last: 1) {
          nodes {
            commit {
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
                        workflowRun {
                          workflow { name }
                        }
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

export const SYNC_PRS_QUERY = `
  query syncPullRequests($owner: String!, $repo: String!, $cursor: String) {
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

export const INCREMENTAL_SYNC_PRS_QUERY = `
  query incrementalSyncPullRequests($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequests(states: OPEN, first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) {
        pageInfo { hasNextPage endCursor }
        nodes { ...PrSummaryFields }
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_BY_NUMBER_QUERY = `
  query getPullRequestByNumber($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        ...PrSummaryFields
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;

export const GET_PR_CHECK_RUNS_BY_URL_QUERY = `
  query getPrCheckRunsByUrl($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
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
                        workflowRun {
                          workflow { name }
                        }
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
