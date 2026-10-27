// Builds and runs the firmware's native tests with whatever C++ compiler is on this machine:
// g++ / clang++ on PATH, or MSVC found through vswhere on Windows. Run from the repo root.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const src = 'firmware/lib/Voltix/src';
const files = ['firmware/test/native/protocol_test.cpp', `${src}/VoltixCrypto.cpp`, `${src}/VoltixProtocol.cpp`];
const outDir = 'firmware/.pio/native-test';
mkdirSync(outDir, { recursive: true });
const exe = join(outDir, process.platform === 'win32' ? 'protocol_test.exe' : 'protocol_test');

const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false }).status === 0;

function buildMsvc() {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (!existsSync(vswhere)) return false;
  const root = execFileSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath',
  ]).toString().trim();
  if (!root) return false;
  const vcvars = join(root, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const cmd = `"${vcvars}" >nul && cl /nologo /std:c++17 /EHsc /W4 /utf-8 /I${src} ${files.join(' ')} /Fo${outDir}\\ /Fe${exe}`;
  return spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmd}"`], {
    stdio: 'inherit',
    windowsVerbatimArguments: true,
    // vcvars64.bat looks for vswhere on PATH.
    env: { ...process.env, PATH: `${dirname(vswhere)};${process.env.PATH}` },
  }).status === 0;
}

const gcc = ['g++', 'clang++'].find(has);
const built = gcc
  ? spawnSync(gcc, ['-std=c++17', '-Wall', '-Wextra', '-Werror', `-I${src}`, ...files, '-o', exe], { stdio: 'inherit' }).status === 0
  : process.platform === 'win32' && buildMsvc();
if (!built) {
  console.error(gcc || process.platform === 'win32' ? 'Native test build failed.' : 'No C++ compiler found (need g++, clang++ or MSVC).');
  process.exit(1);
}
process.exit(spawnSync(exe, { stdio: 'inherit' }).status ?? 1);
