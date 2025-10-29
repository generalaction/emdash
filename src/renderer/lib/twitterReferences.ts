export type TwitterReference = {
  handle: string;
  name: string;
  quote: string;
  tweetUrl: string;
  profileUrl: string;
};

export const twitterReferences: TwitterReference[] = [
  {
    handle: '@tom_doerr',
    name: 'Tom Doerr',
    quote: 'Run multiple coding agents in parallel with a unified UI',
    tweetUrl: 'https://x.com/tom_doerr/status/1977777474416050655',
    profileUrl: 'https://x.com/tom_doerr',
  },
  {
    handle: '@iannuttall',
    name: 'Ian Nuttall',
    quote: 'Now you can run a swarm of droids, or claudes, or codexes in parallel using the open source emdash app',
    tweetUrl: 'https://x.com/iannuttall/status/1973419486553547113',
    profileUrl: 'https://x.com/iannuttall',
  },
  {
    handle: '@1Bexly',
    name: 'Bexly',
    quote: 'This is huge; appreciate this drop 🤝🔥, 🔥',
    tweetUrl: 'https://x.com/1Bexly/status/1973443774941634785',
    profileUrl: 'https://x.com/1Bexly',
  },
];
