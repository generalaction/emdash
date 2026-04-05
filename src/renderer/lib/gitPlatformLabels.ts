import type { GitPlatform } from '../../shared/git/platform';
import githubIcon from '../../assets/images/github.png';
import gitlabIcon from '../../assets/images/GitLab.svg';

export interface PlatformLabels {
  prNoun: string;
  prNounFull: string;
  openSection: string;
  createAction: string;
  mergeAction: string;
  viewAction: string;
}

export interface PlatformIcon {
  src: string;
  alt: string;
  /** GitHub's monochrome logo needs `dark:invert`; GitLab's does not. */
  needsDarkInvert: boolean;
}

const GITHUB_LABELS: PlatformLabels = {
  prNoun: 'PR',
  prNounFull: 'Pull Request',
  openSection: 'Open PRs',
  createAction: 'Create PR',
  mergeAction: 'Merge Pull Request',
  viewAction: 'View PR',
};

const GITLAB_LABELS: PlatformLabels = {
  prNoun: 'MR',
  prNounFull: 'Merge Request',
  openSection: 'Open MRs',
  createAction: 'Create MR',
  mergeAction: 'Merge MR',
  viewAction: 'View MR',
};

export function getPlatformLabels(platform?: GitPlatform | string): PlatformLabels {
  return platform === 'gitlab' ? GITLAB_LABELS : GITHUB_LABELS;
}

export function getPlatformIcon(platform?: GitPlatform | string): PlatformIcon {
  if (platform === 'gitlab') {
    return { src: gitlabIcon, alt: 'GitLab', needsDarkInvert: false };
  }
  return { src: githubIcon, alt: 'GitHub', needsDarkInvert: true };
}
