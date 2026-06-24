#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(repoRoot, args.config ?? 'config/company-ccursor.json');
const reportPath = path.resolve(repoRoot, args.report ?? 'dist/patch-report.json');
const cfg = readJson(configPath);
const report = readJson(reportPath);
const lockedSignature = resolveLockedSignature();

const vsixPath = path.resolve(repoRoot, args.vsix ?? report.artifacts?.patchedVsix ?? '');
if (!vsixPath || !fs.existsSync(vsixPath)) fail(`patched VSIX not found: ${vsixPath}`);

const entries = unzipSync(new Uint8Array(fs.readFileSync(vsixPath)));
const requiredEntries = [
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/company-provider-presets.json',
  'extension.vsixmanifest',
];
for (const entry of requiredEntries) {
  assert(entry in entries, `VSIX contains ${entry}`);
}

const packageJson = JSON.parse(text(entries['extension/package.json']));
const manifestXml = text(entries['extension.vsixmanifest']);
const extensionJs = text(entries['extension/dist/extension.js']);
const providerPresets = JSON.parse(text(entries['extension/company-provider-presets.json']));

const commandIds = (packageJson.contributes?.commands ?? []).map((c) => c.command);
for (const removed of cfg.removeCommands ?? []) {
  assert(!commandIds.includes(removed), `manifest command removed: ${removed}`);
}
assert(commandIds.includes('cursor2plus.editProviders'), 'manifest keeps provider editor command: cursor2plus.editProviders');
assert(packageJson.publisher === cfg.publisher, `extension publisher is ${cfg.publisher}`);
assert(packageJson.displayName === cfg.extensionDisplayName, `extension displayName is ${cfg.extensionDisplayName}`);
assert(manifestXml.includes(`Publisher="${cfg.publisher}"`), `VSIX manifest publisher is ${cfg.publisher}`);
assert(manifestXml.includes(`<DisplayName>${cfg.extensionDisplayName}</DisplayName>`), `VSIX manifest displayName is ${cfg.extensionDisplayName}`);
assert(cfg.companyName === lockedSignature.name, 'config companyName matches locked signature');
assert(cfg.extensionDisplayName === lockedSignature.displayName, 'config extensionDisplayName matches locked signature');

assert(deepEqual(providerPresets, cfg.providerPresets), 'company-provider-presets.json matches config');
for (const provider of cfg.providerPresets?.providers ?? []) {
  assert(providerPresets.providers.some((p) => p.id === provider.id), `provider preset includes ${provider.id}`);
  assert(providerPresets.providers.some((p) => p.baseUrl === provider.baseUrl), `provider preset includes baseUrl for ${provider.id}`);
}
const companyOpenAiPreset = cfg.providerPresets?.providers?.find((p) => p.id === 'company-openai');
assert(companyOpenAiPreset?.type === 'openai-responses', 'company-openai preset type is openai-responses');
assert(companyOpenAiPreset?.baseUrl === 'http://192.168.50.76:3000/v1', 'company-openai preset uses internal /v1 base URL');
const companyAnthropicPreset = cfg.providerPresets?.providers?.find((p) => p.id === 'company-anthropic');
assert(companyAnthropicPreset?.type === 'anthropic', 'company-anthropic preset type is anthropic');
assert(companyAnthropicPreset?.baseUrl === 'http://192.168.50.76:3000', 'company-anthropic preset uses internal base before /v1/messages');
const companyGeminiPreset = cfg.providerPresets?.providers?.find((p) => p.id === 'company-gemini');
assert(companyGeminiPreset?.type === 'gemini', 'company-gemini preset type is gemini');
assert(companyGeminiPreset?.baseUrl === 'http://192.168.50.76:3000/v1beta', 'company-gemini preset uses internal Gemini placeholder base URL');

const requiredJsMarkers = [
  'company local mode: allowed',
  'company_local',
];
for (const marker of requiredJsMarkers) {
  assert(extensionJs.includes(marker), `extension.js contains marker: ${marker}`);
}
assert(extensionJs.includes(cfg.companyName), `extension.js embeds signed-in username/brand: ${cfg.companyName}`);
assert(extensionJs.includes('patched by '), 'extension.js contains patched-by status label');

const forbiddenJsStrings = [
  '[HUB] no token → deny',
  'Cursor++ activated (login-only mode)',
  '[UPDATE] new version available',
  'CCURSOR_COMPANY_STATUS_BAR',
  '[CCURSOR_COMPANY_STATUS_BAR]',
  '$(account) BYOK',
  'CCURSOR_COMPANY_MANAGED_PROVIDERS',
];
for (const forbidden of forbiddenJsStrings) {
  assert(!extensionJs.includes(forbidden), `extension.js does not contain forbidden string: ${forbidden}`);
}

if (entries['extension/dist/webview.js']) {
  const webviewJs = text(entries['extension/dist/webview.js']);
  assert(!webviewJs.includes('company-managed-provider-mode: postMessage guard'), 'webview.js does not contain provider postMessage guard');
  assert(!webviewJs.includes('company-managed-provider-mode: ui guard'), 'webview.js does not contain provider UI guard');
  assert(!webviewJs.includes('blocked provider editor message'), 'webview.js does not block provider editor messages');
}

assert(report.patches?.extensionJs?.replacements >= 2, 'report has extension.js replacements');
assert(report.patches?.extensionJs?.providerNormalizer?.mode === 'preserved-original-provider-editor-flow', 'report preserves original provider normalizer/editor flow');
assert(report.patches?.extensionJs?.statusBar?.mode === 'preserved-original-style', 'report preserves original status bar function');
assert(report.patches?.extensionJs?.statusBar?.signedInLabel === 'patched by', 'report patches signed-in label to patched by');
assert(report.signature?.locked === true, 'report records locked signature mode');
assert(report.signature?.name === lockedSignature.name, 'report signature name matches locked signature');
assert(report.signature?.fingerprint === lockedSignature.fingerprint, 'report signature fingerprint matches locked signature');
assert((report.patches?.extensionJs?.statusBar?.matched ?? []).includes('BYOK OFF — passing through to official Cursor'), 'report decoded original BYOK status bar strings');
assert((report.patches?.extensionJs?.statusBar?.matched ?? []).includes('cursor2plus.toggleByok'), 'report decoded original BYOK toggle command');
assert(report.patches?.extensionPackageJson?.removed === (cfg.removeCommands?.length ?? 0), 'report removed expected command count');

const syntaxTemp = path.join(repoRoot, 'build', 'verify-extension.js');
fs.mkdirSync(path.dirname(syntaxTemp), { recursive: true });
fs.writeFileSync(syntaxTemp, extensionJs);
execFileSync(process.execPath, ['-c', syntaxTemp], { stdio: 'inherit' });
pass(`node syntax check passed: ${path.relative(repoRoot, syntaxTemp)}`);

verifyEmbeddedNpmPackage(report, requiredJsMarkers);

console.log(`\nVerified patched VSIX: ${path.relative(repoRoot, vsixPath)}`);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

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

function text(bytes) {
  return strFromU8(bytes);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assert(condition, message) {
  if (!condition) fail(message);
  pass(message);
}

function pass(message) {
  console.log(`ok - ${message}`);
}

function fail(message) {
  console.error(`not ok - ${message}`);
  process.exit(1);
}

function verifyEmbeddedNpmPackage(report, markers) {
  const tarballRel = report.artifacts?.patchedNpmTarball;
  if (!tarballRel) fail('report missing artifacts.patchedNpmTarball');
  const tarballPath = path.resolve(repoRoot, tarballRel);
  assert(fs.existsSync(tarballPath), `patched npm tarball exists: ${tarballRel}`);

  const extractDir = path.join(repoRoot, 'build', 'verify-npm-tarball');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', extractDir], { stdio: 'inherit' });
  const packageDir = path.join(extractDir, 'package');
  const cliPath = path.join(packageDir, 'dist', 'cli.cjs');
  const presetsPath = path.join(packageDir, 'dist', 'company-provider-presets.json');
  const catalogPath = path.join(packageDir, 'dist', 'models-catalog.json');
  assert(fs.existsSync(cliPath), 'patched npm tarball contains dist/cli.cjs');
  assert(fs.existsSync(presetsPath), 'patched npm tarball contains dist/company-provider-presets.json');
  assert(fs.existsSync(catalogPath), 'patched npm tarball contains dist/models-catalog.json');
  const cliJs = fs.readFileSync(cliPath, 'utf8');
  assert(cliJs.includes('CCURSOR_COMPANY_PROVIDER_PRESET_SEEDER'), 'patched CLI contains provider preset seeder');
  for (const provider of cfg.providerPresets?.providers ?? []) {
    assert(cliJs.includes(provider.id), `patched CLI embeds provider preset ${provider.id}`);
    assert(cliJs.includes(provider.baseUrl), `patched CLI embeds provider preset baseUrl for ${provider.id}`);
  }
  execFileSync(process.execPath, ['-c', cliPath], { stdio: 'inherit' });
  pass('node syntax check passed: extracted npm dist/cli.cjs');
  const packagePresets = readJson(presetsPath);
  assert(deepEqual(packagePresets, cfg.providerPresets), 'npm dist/company-provider-presets.json matches config');
  const catalog = readJson(catalogPath);
  for (const provider of cfg.providerPresets?.providers ?? []) {
    assert(catalog[provider.id]?.api === provider.baseUrl, `npm models-catalog includes provider preset ${provider.id}`);
  }
  assert(catalog['company-openai']?.npm === '@ai-sdk/openai', 'npm models-catalog maps company-openai/openai-responses to @ai-sdk/openai');
  assert(catalog['company-anthropic']?.npm === '@ai-sdk/anthropic', 'npm models-catalog maps company-anthropic to @ai-sdk/anthropic');
  assert(catalog['company-gemini']?.npm === '@ai-sdk/google', 'npm models-catalog maps company-gemini to @ai-sdk/google');

  const embeddedVsixDir = path.join(packageDir, 'vsix');
  const embeddedVsixes = fs.readdirSync(embeddedVsixDir).filter((f) => f.endsWith('.vsix'));
  assert(embeddedVsixes.length === 1, 'patched npm tarball contains exactly one bundled VSIX');

  const embeddedVsixPath = path.join(embeddedVsixDir, embeddedVsixes[0]);
  const embeddedEntries = unzipSync(new Uint8Array(fs.readFileSync(embeddedVsixPath)));
  assert('extension/dist/extension.js' in embeddedEntries, 'bundled npm VSIX contains extension/dist/extension.js');
  const embeddedExtensionJs = text(embeddedEntries['extension/dist/extension.js']);
  for (const marker of markers) {
    assert(embeddedExtensionJs.includes(marker), `bundled npm VSIX extension.js contains marker: ${marker}`);
  }
  const embeddedPkg = JSON.parse(text(embeddedEntries['extension/package.json']));
  assert(embeddedPkg.publisher === cfg.publisher, `bundled npm VSIX publisher is ${cfg.publisher}`);
  assert(embeddedPkg.displayName === cfg.extensionDisplayName, `bundled npm VSIX displayName is ${cfg.extensionDisplayName}`);
}
