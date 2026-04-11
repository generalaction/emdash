import forgejoLogo from '@/assets/images/Forgejo.svg';
import githubLogo from '@/assets/images/github.png';
import gitlabLogo from '@/assets/images/GitLab.svg';
import jiraLogo from '@/assets/images/jira.png';
import linearLogo from '@/assets/images/Linear.svg';
import plainLogo from '@/assets/images/Plain.svg';
import type { IssueProviderType } from '@shared/issue-providers';

export const ISSUE_PROVIDER_ORDER: IssueProviderType[] = [
  'linear',
  'github',
  'jira',
  'gitlab',
  'forgejo',
  'plain',
];

export const ISSUE_PROVIDER_META: Record<
  IssueProviderType,
  {
    displayName: string;
    logo: string;
  }
> = {
  linear: { displayName: 'Linear', logo: linearLogo },
  github: { displayName: 'GitHub', logo: githubLogo },
  jira: { displayName: 'Jira', logo: jiraLogo },
  gitlab: { displayName: 'GitLab', logo: gitlabLogo },
  forgejo: { displayName: 'Forgejo', logo: forgejoLogo },
  plain: { displayName: 'Plain', logo: plainLogo },
};
