#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));

const distDir = path.resolve(repoRoot, args.dist ?? 'dist');
const releaseDir = path.resolve(repoRoot, args.out ?? path.join('dist', 'release'));
const configPath = path.resolve(repoRoot, args.config ?? 'config/company-ccursor.json');
const reportPath = path.resolve(repoRoot, args.report ?? path.join(distDir, 'patch-report.json'));
const baseUrl = normalizeBaseUrl(args.baseUrl ?? process.env.CCURSOR_RELEASE_BASE_URL ?? defaultBaseUrl());

const cfg = readJson(configPath);
const signature = resolveLockedSignature();
applyLockedSignature(cfg, signature);
const report = readJson(reportPath);
verifyPatchReportSignature(report, signature);
const tarball = path.resolve(repoRoot, report.artifacts?.patchedNpmTarball ?? '');
const vsix = path.resolve(repoRoot, report.artifacts?.patchedVsix ?? '');
if (!fs.existsSync(tarball)) throw new Error(`patched tarball not found: ${tarball}`);
if (!fs.existsSync(vsix)) throw new Error(`patched VSIX not found: ${vsix}`);

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

const tarballName = path.basename(tarball);
const vsixName = path.basename(vsix);
copy(tarball, path.join(releaseDir, tarballName));
copy(vsix, path.join(releaseDir, vsixName));
copy(reportPath, path.join(releaseDir, 'patch-report.json'));

for (const script of ['install.ps1', 'install.sh', 'uninstall.ps1', 'uninstall.sh']) {
  const src = path.join(repoRoot, 'release', script);
  const out = path.join(releaseDir, script);
  let text = fs.readFileSync(src, 'utf8');
  text = text
    .replaceAll('__CCURSOR_RELEASE_BASE_URL__', baseUrl)
    .replaceAll('__CCURSOR_PATCHED_BY__', signature.name)
    .replaceAll('__CCURSOR_DISPLAY_NAME__', signature.displayName)
    .replaceAll('__CCURSOR_SIGNATURE_FINGERPRINT__', signature.fingerprint);
  fs.writeFileSync(out, text, script.endsWith('.sh') ? { mode: 0o755 } : undefined);
}

const latest = {
  schemaVersion: 1,
  name: signature.displayName,
  upstreamPackage: '@cometix/ccursor',
  upstreamVersion: report.sourceVersion,
  companyVersion: report.patches?.npmPackageJson?.newVersion,
  patchedBy: signature.name,
  generatedAt: new Date().toISOString(),
  releaseBaseUrl: baseUrl,
  signature: publicSignatureReport(signature),
  minNodeMajor: 18,
  tarball: fileEntry(tarballName),
  vsix: fileEntry(vsixName),
  patchReport: fileEntry('patch-report.json'),
  install: {
    windows: 'install.ps1',
    macos: 'install.sh'
  },
  uninstall: {
    windows: 'uninstall.ps1',
    macos: 'uninstall.sh'
  },
  notes: [
    `Internal team use only. Unauthorized modification, redistribution, or resale is prohibited.`,
    `This package is a ${signature.name} company-local patch of Cursor++.`,
    'Provider editing remains available; company provider presets are seeded during ccursor install.',
    'Set Cursor network mode to HTTP/1.1 and make sure Cursor++ BYOK is ON after installation.',
    'Update by closing Cursor, uninstalling this patch, then installing again.',
    'VSIX-only install is not enough for the lower-left BYOK account/glass entry; use the install scripts or ccursor install path.'
  ]
};

fs.writeFileSync(path.join(releaseDir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
fs.writeFileSync(path.join(releaseDir, 'release-notes.md'), releaseNotes(latest));

console.log(`Prepared release directory: ${path.relative(repoRoot, releaseDir)}`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Tarball: ${tarballName}`);
console.log(`VSIX: ${vsixName}`);


function resolveLockedSignature() {
  const parts = [
    Buffer.from('azA=', 'base64').toString('utf8'),
    String.fromCharCode(0x62, 0x61),
    'ya'
  ];
  const name = parts.join('');
  const label = ['pa', 'tch', 'ed', ' by'].join('');
  const displayName = ['Cursor++ ', name, ' Local'].join('');
  const presetBy = [name, 'company', 'patch'].join('-');
  return {
    locked: true,
    name,
    label,
    displayName,
    presetBy,
    fingerprint: 'kbya-20260624-local'
  };
}

function publicSignatureReport(sig) {
  return {
    locked: true,
    name: sig.name,
    displayName: sig.displayName,
    statusLabel: sig.label,
    fingerprint: sig.fingerprint
  };
}

function applyLockedSignature(cfg, sig) {
  if (cfg.companyName && cfg.companyName !== sig.name) {
    throw new Error(`config companyName must remain ${sig.name}; got ${cfg.companyName}`);
  }
  if (cfg.extensionDisplayName && cfg.extensionDisplayName !== sig.displayName) {
    throw new Error(`config extensionDisplayName must remain ${sig.displayName}; got ${cfg.extensionDisplayName}`);
  }
  cfg.companyName = sig.name;
  cfg.extensionDisplayName = sig.displayName;
  if (cfg.providerPresets) {
    if (cfg.providerPresets.presetBy && cfg.providerPresets.presetBy !== sig.presetBy) {
      throw new Error(`config providerPresets.presetBy must remain ${sig.presetBy}; got ${cfg.providerPresets.presetBy}`);
    }
    cfg.providerPresets.presetBy = sig.presetBy;
  }
}

function verifyPatchReportSignature(rpt, sig) {
  const actual = rpt.signature ?? {};
  if (actual.locked !== true || actual.name !== sig.name || actual.fingerprint !== sig.fingerprint) {
    throw new Error(`patch report signature mismatch; rebuild with the locked ${sig.name} patch script first`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) out[key] = argv[++i];
    else out[key] = true;
  }
  return out;
}

function defaultBaseUrl() {
  if (process.env.GITHUB_REPOSITORY) {
    return `https://github.com/${process.env.GITHUB_REPOSITORY}/releases/latest/download`;
  }
  return '__CCURSOR_RELEASE_BASE_URL__';
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/+$/, '');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function copy(src, dest) {
  fs.copyFileSync(src, dest);
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fileEntry(name) {
  const file = path.join(releaseDir, name);
  return {
    name,
    size: fs.statSync(file).size,
    sha256: sha256File(file),
    url: `${baseUrl}/${name}`
  };
}

function releaseNotes(latest) {
  return `# ${latest.name} ${latest.companyVersion}

Patched by: ${latest.patchedBy}

> Internal team use only. Unauthorized modification, redistribution, or resale is prohibited.

Upstream: ${latest.upstreamPackage}@${latest.upstreamVersion}

## Windows install

\`\`\`powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm ${latest.releaseBaseUrl}/install.ps1 | iex"
\`\`\`

## macOS install

\`\`\`bash
/bin/bash -c "$(curl -fsSL ${latest.releaseBaseUrl}/install.sh)"
\`\`\`

## Windows uninstall

\`\`\`powershell
powershell -ExecutionPolicy Bypass -NoProfile -Command "irm ${latest.releaseBaseUrl}/uninstall.ps1 | iex"
\`\`\`

## macOS uninstall

\`\`\`bash
/bin/bash -c "$(curl -fsSL ${latest.releaseBaseUrl}/uninstall.sh)"
\`\`\`

## Required Cursor settings

- Cursor network mode: HTTP/1.1
- Cursor++ BYOK status: ON
- Recommended orientation: vertical

## Assets

- ${latest.tarball.name}
- ${latest.vsix.name}
- patch-report.json
- latest.json
`;
}
