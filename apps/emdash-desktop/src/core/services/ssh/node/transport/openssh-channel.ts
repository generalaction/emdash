import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Duplex, PassThrough } from 'node:stream';

/** 将进程管道映射成 SSH 通道；必须等退出码到达后才报告 close。 */
export class OpenSshChannel extends Duplex {
  readonly stderr = new PassThrough();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    super({ autoDestroy: false, emitClose: false });
    child.stdout.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) child.stdout.pause();
    });
    child.stdout.on('end', () => this.push(null));
    child.stderr.pipe(this.stderr);
    child.on('error', (error) => this.destroy(error));
    child.stdin.on('error', (error) => this.destroy(error));
    child.on('close', (code) => {
      this.destroy();
      this.emit('close', code ?? 255);
    });
  }

  override _read(): void {
    this.child.stdout.resume();
  }

  override _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.child.stdin.write(chunk, encoding, callback);
  }

  override _final(callback: (error?: Error | null) => void): void {
    this.child.stdin.end(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.child.kill();
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.stderr.destroy();
    callback(error);
  }
}
