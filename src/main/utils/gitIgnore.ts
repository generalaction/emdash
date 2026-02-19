import ignore from 'ignore';

export class GitIgnoreParser {
  // Use any because strict typing of the ignore package might vary, but logically it's an Ignore object
  private ig: any;

  constructor(content: string) {
    this.ig = ignore().add(content);
  }

  public ignores(path: string, _isDir: boolean = false): boolean {
    // The ignore package uses relative paths.
    // If the path ends with / it might treat it as dir, but our path input from fsListWorker typically doesn't have trailing slash.
    // 'ignore' usually handles 'node_modules' correctly matching directory.
    return this.ig.ignores(path);
  }
}
