import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const REPO = 'cloudflare-d1-adapter';

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.on('exit', code => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} failed with ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const bucket = readRequiredEnv('OPENAPI_R2_BUCKET');
  const channel = readRequiredEnv('OPENAPI_CHANNEL');
  const versionId = process.env.GITHUB_SHA ?? `manual-${Date.now()}`;
  const generatedAt = new Date().toISOString();
  const tempDir = await mkdtemp(join(tmpdir(), `${REPO}-openapi-`));
  const metadataPath = join(tempDir, 'metadata.json');

  try {
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          repo: REPO,
          channel,
          currentVersion: versionId,
          generatedAt,
          sourcePath: 'openapi.json',
        },
        null,
        2,
      ),
    );

    await runCommand(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/openapi/${REPO}/${channel}/latest.json`,
        '--remote',
        '--file',
        join(process.cwd(), 'openapi.json'),
        '--content-type',
        'application/json',
      ],
      { cwd: process.cwd(), env: process.env },
    );

    await runCommand(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/openapi/${REPO}/${channel}/versions/${versionId}.json`,
        '--remote',
        '--file',
        join(process.cwd(), 'openapi.json'),
        '--content-type',
        'application/json',
      ],
      { cwd: process.cwd(), env: process.env },
    );

    await runCommand(
      'npx',
      [
        'wrangler',
        'r2',
        'object',
        'put',
        `${bucket}/openapi/${REPO}/${channel}/metadata.json`,
        '--remote',
        '--file',
        metadataPath,
        '--content-type',
        'application/json',
      ],
      { cwd: process.cwd(), env: process.env },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
