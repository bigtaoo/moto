import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ci-deploy.sh refuses to deploy unless the Dockerfile and docker-compose.yml on the box hash to the
// values written into it, because those two files decide what runs and with which mounts and so are
// installed by hand, never by CI (server/README.md). That guard only works while the hashes in the
// script are the hashes of the files here -- otherwise every deploy fails with a message about a file
// nobody touched. This test is what keeps the two in step: edit either file and it goes red until the
// new hash is in the script, which is also the reminder to install the file on the box.

const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (name: string): Buffer => readFileSync(join(here, name));
const sha = (name: string): string => createHash('sha256').update(read(name)).digest('hex');
const script = readFileSync(join(here, 'ci-deploy.sh'), 'utf8');

describe('what the box is told to trust', () => {
  it.each([
    ['Dockerfile', 'DOCKERFILE_SHA256'],
    ['docker-compose.yml', 'COMPOSE_SHA256'],
  ])('ci-deploy.sh holds the hash of %s', (name, variable) => {
    const written = new RegExp(`^${variable}=([0-9a-f]{64})$`, 'm').exec(script)?.[1];
    expect(written, `${variable} is not in ci-deploy.sh`).toBeDefined();
    expect(written, `${name} changed: install it on the box and put this hash in ci-deploy.sh`).toBe(sha(name));
  });

  it('ships every file the Dockerfile copies in, and no test', () => {
    const copied = /^COPY ((?:\S+\.ts )+)\.\/$/m.exec(read('Dockerfile').toString('utf8'))?.[1].trim().split(' ');
    const packed = /^FILES="([^"]+)"$/m.exec(script)?.[1].split(' ');
    expect(copied).toEqual(packed);
    expect(packed?.some((f) => f.includes('.test.'))).toBe(false);
  });

  it('keeps those files free of the CRLF that would break the shell on the box', () => {
    for (const name of ['ci-deploy.sh', 'Dockerfile', 'docker-compose.yml']) {
      expect(read(name).includes('\r'), `${name} has CRLF in it`).toBe(false);
    }
  });
});
