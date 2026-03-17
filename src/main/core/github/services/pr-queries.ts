const PR_SUMMARY_FRAGMENT = `
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
    author { login }
    headRepository {
      nameWithOwner
      url
      owner { login }
    }
    labels(first: 10) { nodes { name color } }
    assignees(first: 10) { nodes { login avatarUrl } }
    reviewDecision
    latestReviews(first: 10) {
      nodes {
        author { login }
        state
      }
    }
    reviewRequests(first: 10) {
      nodes {
        requestedReviewer {
          ... on User { login }
          ... on Team { name }
        }
      }
    }
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
  query searchPullRequests($query: String!, $limit: Int!) {
    search(query: $query, type: ISSUE, first: $limit) {
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
        body
        additions
        deletions
        changedFiles
        mergeable
        mergeStateStatus
      }
    }
  }
  ${PR_SUMMARY_FRAGMENT}
`;
