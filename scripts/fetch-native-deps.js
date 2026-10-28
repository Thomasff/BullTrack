// Downloads the prebuilt OpenCV and ncnn Android SDKs that app/src/main/cpp/CMakeLists.txt expects.
// Usage: node scripts/fetch-native-deps.js [--force]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const cppDir = path.join(__dirname, '..', 'app', 'src', 'main', 'cpp');
const tempDir = path.join(cppDir, '.deps-download');

const deps = [
  {
    name: 'OpenCV Android SDK 4.12.0',
    url: 'https://github.com/opencv/opencv/releases/download/4.12.0/opencv-4.12.0-android-sdk.zip',
    sha256: 'fd7f2332331b4eb8b67e55137281cfb16823c9399d90deb9cfa3476783b99e35',
    // Folder inside the archive -> folder in app/src/main/cpp
    from: path.join('OpenCV-android-sdk', 'sdk'),
    to: path.join('opencv-sdk', 'sdk'),
    marker: path.join('native', 'jni', 'OpenCVConfig.cmake'),
  },
  {
    name: 'ncnn 20260113 (android-vulkan)',
    url: 'https://github.com/Tencent/ncnn/releases/download/20260113/ncnn-20260113-android-vulkan.zip',
    sha256: '41944630a7b305b190e7caea4b405bc6d103c6383dc4988e9e85616058e3cccd',
    from: 'ncnn-20260113-android-vulkan',
    to: path.join('third_party', 'ncnn-20260113-android-vulkan'),
    marker: path.join('arm64-v8a', 'lib', 'cmake', 'ncnn', 'ncnnConfig.cmake'),
  },
];

const download = async (url, filePath) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  let received = 0;
  let lastPercent = -1;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      const percent = total ? Math.floor((received / total) * 100) : -1;
      if (percent !== lastPercent && percent % 10 === 0) {
        lastPercent = percent;
        process.stdout.write(`  ${percent}%`);
      }
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(filePath));
  process.stdout.write('\n');
  return hash.digest('hex');
};

const extract = (zipPath, outDir) => {
  // GNU tar (Linux, Git Bash) cannot read zip files; the tar shipped with Windows and macOS can.
  const [command, args] =
    process.platform === 'win32'
      ? [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zipPath, '-C', outDir]]
      : process.platform === 'darwin'
        ? ['tar', ['-xf', zipPath, '-C', outDir]]
        : ['unzip', ['-q', zipPath, '-d', outDir]];
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not extract ${zipPath} with ${command}${result.error ? `: ${result.error.message}` : ''}`);
  }
};

const main = async () => {
  const force = process.argv.includes('--force');

  for (const dep of deps) {
    const target = path.join(cppDir, dep.to);
    if (!force && fs.existsSync(path.join(target, dep.marker))) {
      console.log(`${dep.name}: already in ${path.relative(process.cwd(), target)}, skipped (use --force to replace)`);
      continue;
    }

    console.log(`${dep.name}: downloading ${dep.url}`);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, path.basename(dep.url));
    const digest = await download(dep.url, zipPath);
    if (digest !== dep.sha256) {
      throw new Error(`${dep.name}: SHA-256 mismatch (expected ${dep.sha256}, got ${digest})`);
    }

    console.log(`${dep.name}: extracting`);
    const extractDir = path.join(tempDir, 'extracted');
    fs.mkdirSync(extractDir);
    extract(zipPath, extractDir);
    const source = path.join(extractDir, dep.from);
    if (!fs.existsSync(path.join(source, dep.marker))) {
      throw new Error(`${dep.name}: ${path.join(dep.from, dep.marker)} not found in the archive`);
    }

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(source, target);
    console.log(`${dep.name}: done -> ${path.relative(process.cwd(), target)}`);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
};

main().catch(error => {
  console.error(error.message);
  fs.rmSync(tempDir, { recursive: true, force: true });
  process.exit(1);
});
