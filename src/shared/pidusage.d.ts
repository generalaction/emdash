declare module 'pidusage' {
  export interface Stat {
    cpu: number;
    memory: number;
    ppid: number;
    pid: number;
    ctime: number;
    elapsed: number;
    timestamp: number;
  }

  function pidusage(pid: number): Promise<Stat>;
  function pidusage(pids: number[]): Promise<Record<string, Stat>>;

  namespace pidusage {
    function clear(): void;
  }

  export default pidusage;
}
