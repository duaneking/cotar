import o from 'ospec';
import * as cp from 'child_process';
import * as path from 'path';
import { promises as fs } from 'fs';
import { FileHandle } from 'fs/promises';
import { TarFileHeader, TarReader } from '../tar';
import { TarIndexRecord } from '../tar.index';
import { Cotar } from '../cotar';
import { MemorySource } from '../source.memory';
import { CotarIndexNdjson } from '../cotar.index.ndjson';

o.spec('TarReader', () => {
  // Create a Tar file of the built source
  o.before(() => {
    cp.execSync(`tar cf ${tarFilePath} tar.test.*`, { cwd: __dirname });
  });
  const tarFilePath = path.join(__dirname, 'test.tar');
  const tarFileIndexPath = path.join(__dirname, 'test.tar.index');

  let fd: FileHandle | null;
  const headBuffer = Buffer.alloc(512);
  async function readBytes(offset: number, count: number): Promise<Buffer | null> {
    if (fd == null) throw new Error('File is closed');
    const res = await fd.read(headBuffer, 0, count, offset);
    if (res.bytesRead < count) return null;
    return headBuffer;
  }
  o.beforeEach(async () => {
    fd = await fs.open(tarFilePath, 'r');
  });
  o.afterEach(() => fd?.close());

  o('should iterate files', async () => {
    const files: TarFileHeader[] = [];
    for await (const file of TarReader.iterate(readBytes)) files.push(file);
    o(files.map((c) => c.header.path)).deepEquals(['tar.test.d.ts', 'tar.test.d.ts.map', 'tar.test.js']);
  });

  o('should index files', async () => {
    const index: string[] = [];
    for await (const ctx of TarReader.iterate(readBytes)) {
      index.push(JSON.stringify([ctx.header.path, ctx.offset, ctx.header.size]));
    }

    const source = new MemorySource('Tar', await fs.readFile(tarFilePath));

    const tar = new Cotar(source, new CotarIndexNdjson(Buffer.from(index.join('\n'))));

    const buf = await tar.get('tar.test.js');
    o(buf).notEquals(null);
    const text = Buffer.from(buf!).toString();
    o(text.slice(0, 12)).deepEquals('"use strict"');
  });

  o('should create a index', async () => {
    const source = await fs.open(tarFilePath, 'r');

    const files = await TarReader.index(source);
    fs.writeFile(tarFileIndexPath, files.join('\n'));

    await source.close();

    const tarIndexRaw = await fs.readFile(tarFileIndexPath);
    o(files.length >= 3).equals(true);

    const tarIndex = tarIndexRaw
      .toString()
      .split('\n')
      .map((c) => JSON.parse(c));

    const tarTest = tarIndex.find((f: TarIndexRecord) => f[0] === 'tar.test.js');
    o(tarTest).notEquals(undefined);
    o(tarTest.length).equals(3);
  });
});
