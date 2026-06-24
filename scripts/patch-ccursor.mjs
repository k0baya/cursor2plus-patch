#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const configPath = path.resolve(repoRoot, args.config ?? 'config/company-ccursor.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const signature = resolveLockedSignature();
applyLockedSignature(config, signature);
const requestedVersion = args.version ?? 'latest';
const outDir = path.resolve(repoRoot, args.outDir ?? 'dist');
const workRoot = path.resolve(repoRoot, args.workDir ?? 'build/work');
const packageSpec = `@cometix/ccursor@${requestedVersion}`;
const report = { packageSpec, configPath, generatedAt: new Date().toISOString(), signature: publicSignatureReport(signature), steps: [], patches: {} };

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(workRoot, { recursive: true });

const tarball = npmPack(packageSpec, workRoot);
const npmRoot = path.join(workRoot, 'npm');
extractTgz(tarball, npmRoot);
const packageDir = path.join(npmRoot, 'package');
const npmPackageJsonPath = path.join(packageDir, 'package.json');
const npmPackageJson = readJson(npmPackageJsonPath);
report.sourceVersion = npmPackageJson.version;
const vsixDir = path.join(packageDir, 'vsix');
const vsixPath = findOne(fs.readdirSync(vsixDir).filter((f) => f.endsWith('.vsix')).map((f) => path.join(vsixDir, f)), 'bundled VSIX');
report.sourceVsix = path.relative(repoRoot, vsixPath);

const vsixWork = path.join(workRoot, 'vsix');
unzipFile(vsixPath, vsixWork);
const extensionDir = path.join(vsixWork, 'extension');
const extensionJsonPath = path.join(extensionDir, 'package.json');
const vsixManifestPath = path.join(vsixWork, 'extension.vsixmanifest');
const extensionJsPath = path.join(extensionDir, 'dist', 'extension.js');
const cliJsPath = path.join(packageDir, 'dist', 'cli.cjs');

patchExtensionPackageJson(extensionJsonPath, config, report);
patchVsixManifest(vsixManifestPath, config, report);
patchExtensionJs(extensionJsPath, config, report);
writeProviderPresets(extensionDir, packageDir, config, report);
patchCliJs(cliJsPath, config, report);
patchNpmPackage(npmPackageJsonPath, config, report);

const patchedVsixName = `cursor2plus-${npmPackageJson.version}-company.vsix`;
const patchedVsixPath = path.join(outDir, patchedVsixName);
zipDirectory(vsixWork, patchedVsixPath);
fs.copyFileSync(patchedVsixPath, vsixPath);
report.artifacts = { patchedVsix: path.relative(repoRoot, patchedVsixPath) };

const packedName = npmPackLocal(packageDir, outDir);
report.artifacts.patchedNpmTarball = path.relative(repoRoot, path.join(outDir, packedName));

const reportPath = path.join(outDir, 'patch-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else out[key] = argv[++i];
    }
  }
  return out;
}

function resolveLockedSignature() {
  const name = [
    Buffer.from('azA=', 'base64').toString('utf8'),
    String.fromCharCode(0x62, 0x61),
    'ya'
  ].join('');
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

function npmPack(spec, cwd) {
  const stdout = runNpm(['pack', spec, '--silent'], cwd).trim();
  const name = stdout.split(/\r?\n/).filter(Boolean).at(-1);
  if (!name) throw new Error(`npm pack returned no tarball name for ${spec}`);
  const tarball = path.join(cwd, name);
  if (!fs.existsSync(tarball)) throw new Error(`npm pack tarball missing: ${tarball}`);
  report.steps.push({ step: 'npm-pack-source', spec, tarball: path.relative(repoRoot, tarball) });
  return tarball;
}

function npmPackLocal(pkgDir, cwd) {
  const stdout = runNpm(['pack', pkgDir, '--silent'], cwd).trim();
  const name = stdout.split(/\r?\n/).filter(Boolean).at(-1);
  if (!name || !fs.existsSync(path.join(cwd, name))) throw new Error(`local npm pack failed: ${stdout}`);
  report.steps.push({ step: 'npm-pack-patched', tarball: path.relative(repoRoot, path.join(cwd, name)) });
  return name;
}

function extractTgz(tarball, dest) {
  fs.mkdirSync(dest, { recursive: true });
  execFileSync('tar', ['-xzf', tarball, '-C', dest], { stdio: 'inherit' });
}

function unzipFile(zipPath, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  for (const [name, data] of Object.entries(entries)) {
    const out = path.join(dest, name.replace(/\//g, path.sep));
    if (name.endsWith('/')) fs.mkdirSync(out, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(data));
    }
  }
}

function zipDirectory(srcDir, outFile) {
  const entries = {};
  for (const file of listFiles(srcDir)) {
    const rel = path.relative(srcDir, file).replace(/\\/g, '/');
    entries[rel] = new Uint8Array(fs.readFileSync(file));
  }
  const zipped = zipSync(entries, { level: 9 });
  fs.writeFileSync(outFile, Buffer.from(zipped));
}

function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }
function findOne(items, label) { if (items.length !== 1) throw new Error(`Expected exactly one ${label}, found ${items.length}: ${items.join(', ')}`); return items[0]; }

function patchExtensionPackageJson(file, cfg, rpt) {
  const pkg = readJson(file);
  const oldIdentity = { name: pkg.name, publisher: pkg.publisher, displayName: pkg.displayName, version: pkg.version };
  const beforeCommands = pkg.contributes?.commands?.length ?? 0;
  const remove = new Set(cfg.removeCommands ?? []);
  pkg.displayName = signature.displayName;
  if (cfg.publisher) pkg.publisher = cfg.publisher;
  if (pkg.contributes?.commands) pkg.contributes.commands = pkg.contributes.commands.filter((c) => !remove.has(c.command));
  const afterCommands = pkg.contributes?.commands?.length ?? 0;
  writeJson(file, pkg);
  rpt.patches.extensionPackageJson = { oldIdentity, newIdentity: { name: pkg.name, publisher: pkg.publisher, displayName: pkg.displayName, version: pkg.version }, beforeCommands, afterCommands, removed: beforeCommands - afterCommands };
}

function patchVsixManifest(file, cfg, rpt) {
  if (!fs.existsSync(file)) {
    rpt.patches.vsixManifest = { skipped: true, reason: 'extension.vsixmanifest not found' };
    return;
  }
  let xml = fs.readFileSync(file, 'utf8');
  const before = {
    publisher: xml.match(/\bPublisher="([^"]+)"/)?.[1] ?? null,
    displayName: xml.match(/<DisplayName>([^<]*)<\/DisplayName>/)?.[1] ?? null,
  };
  if (cfg.publisher) xml = xml.replace(/\bPublisher="[^"]*"/, `Publisher="${xmlEscapeAttr(cfg.publisher)}"`);
  xml = xml.replace(/<DisplayName>[^<]*<\/DisplayName>/, `<DisplayName>${xmlEscapeText(signature.displayName)}</DisplayName>`);
  if (cfg.extensionDescription) xml = xml.replace(/<Description xml:space="preserve">[\s\S]*?<\/Description>/, `<Description xml:space="preserve">${xmlEscapeText(cfg.extensionDescription)}</Description>`);
  fs.writeFileSync(file, xml);
  rpt.patches.vsixManifest = {
    before,
    after: {
      publisher: xml.match(/\bPublisher="([^"]+)"/)?.[1] ?? null,
      displayName: xml.match(/<DisplayName>([^<]*)<\/DisplayName>/)?.[1] ?? null,
    }
  };
}

function patchNpmPackage(file, cfg, rpt) {
  const pkg = readJson(file);
  const oldName = pkg.name;
  const oldVersion = pkg.version;
  if (cfg.patchNpmPackageName && cfg.packageName) pkg.name = cfg.packageName;
  if (cfg.baseVersionSuffix && !pkg.version.includes(cfg.baseVersionSuffix)) pkg.version = `${pkg.version}-${cfg.baseVersionSuffix}`;
  pkg.description = `${pkg.description ?? 'Cursor++'} (company local patched)`;
  writeJson(file, pkg);
  rpt.patches.npmPackageJson = { oldName, newName: pkg.name, oldVersion, newVersion: pkg.version };
}

function writeProviderPresets(extensionDir, packageDir, cfg, rpt) {
  const presets = cfg.providerPresets ?? cfg.managedProviders;
  if (!presets?.providers?.length) {
    rpt.patches.providerPresets = { skipped: true, reason: 'no providerPresets.providers configured' };
    return;
  }
  const content = JSON.stringify(presets, null, 2) + '\n';
  const extPath = path.join(extensionDir, 'company-provider-presets.json');
  fs.writeFileSync(extPath, content);
  const packagePath = path.join(packageDir, 'dist', 'company-provider-presets.json');
  fs.writeFileSync(packagePath, content);
  const catalogPath = path.join(packageDir, 'dist', 'models-catalog.json');
  if (fs.existsSync(catalogPath)) {
    const catalog = readJson(catalogPath);
    for (const p of presets.providers ?? []) {
      catalog[p.id] = {
        id: p.id,
        env: [],
        npm: providerNpm(p.type),
        api: p.baseUrl,
        name: p.name,
        doc: 'Company preset provider',
        models: Object.fromEntries((p.models ?? []).map((m) => [m.id, {
          id: m.id,
          name: m.name ?? m.id,
          provider: { npm: providerNpm(p.type), api: p.baseUrl },
        }]))
      };
    }
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  }
  rpt.patches.providerPresets = {
    extensionFile: 'extension/company-provider-presets.json',
    packageFile: 'dist/company-provider-presets.json',
    packageCatalogFile: 'dist/models-catalog.json',
    providerCount: presets.providers?.length ?? 0,
    mode: 'seed-defaults-and-keep-editor'
  };
}

function providerNpm(type) {
  if (type === 'anthropic') return '@ai-sdk/anthropic';
  if (type === 'google' || type === 'gemini') return '@ai-sdk/google';
  if (type === 'openai' || type === 'openai-responses') return '@ai-sdk/openai';
  return '@ai-sdk/openai-compatible';
}

function xmlEscapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function xmlEscapeAttr(value) {
  return xmlEscapeText(value).replaceAll('"', '&quot;');
}

function patchExtensionJs(file, cfg, rpt) {
  let src = fs.readFileSync(file, 'utf8');
  const decoder = buildExtensionDecoder(src);
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script', ranges: true });
  const replacements = [];

  const hubCheck = findFunctionByStrings(ast, src, decoder, [
    '[HUB] no token → deny',
    '[HUB] online OK, user=',
    '[HUB] unauthorized → token cleared',
    'ok_cached'
  ], { label: 'Hub auth check', minMatches: 4 });
  replacements.push({ start: hubCheck.start, end: hubCheck.end, text: `async function ${hubCheck.name}(fQ4YPip,kgsu5p0){try{kgsu5p0&&kgsu5p0("[HUB] company local mode: allowed")}catch{}return {allowed:true,reason:"company_local",username:${JSON.stringify(signature.name)}}}` });

  const hubRecheck = findFunctionByStrings(ast, src, decoder, [
    '[HUB] periodic re-check detected revoke'
  ], { label: 'Hub periodic recheck', minMatches: 1 });
  replacements.push({ start: hubRecheck.start, end: hubRecheck.end, text: `function ${hubRecheck.name}(fQ4YPip,kgsu5p0,mPGFd2F){return {dispose(){}}}` });

  const statusBar = findFunctionByStrings(ast, src, decoder, [
    '$(account) Sign in to Cursor++',
    'Cursor++ Hub 未登录。点击进行设备授权。',
    'BYOK OFF — passing through to official Cursor',
    'cursor2plus.toggleByok'
  ], { label: 'status bar updater', minMatches: 4 });
  const signedInLabel = findDecodedStringExpression(statusBar.node, decoder, '\nSigned in as ', {
    label: 'status bar signed-in label'
  });
  replacements.push({ start: signedInLabel.start, end: signedInLabel.end, text: JSON.stringify(`\n${signature.label} `) });

  const updateFn = findFunctionByStrings(ast, src, decoder, [
    '[UPDATE] new version available: '
  ], { label: 'npm update checker', minMatches: 1, optional: true });
  if (updateFn && cfg.disableNpmUpdateCheck) replacements.push({ start: updateFn.start, end: updateFn.end, text: `async function ${updateFn.name}(fQ4YPip,kgsu5p0){return}` });

  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) src = src.slice(0, r.start) + r.text + src.slice(r.end);
  fs.writeFileSync(file, src);
  rpt.patches.extensionJs = {
    hubCheck: summarizeFn(hubCheck),
    hubRecheck: summarizeFn(hubRecheck),
    providerNormalizer: { mode: 'preserved-original-provider-editor-flow' },
    statusBar: { ...summarizeFn(statusBar), mode: 'preserved-original-style', signedInLabel: signature.label },
    updateChecker: updateFn ? summarizeFn(updateFn) : null,
    replacements: replacements.length
  };
}

function findDecodedStringExpression(node, decoder, target, opts = {}) {
  const hits = [];
  walk.simple(node, {
    CallExpression(n) {
      if (decodeNode(n, decoder) === target) hits.push(n);
    },
    MemberExpression(n) {
      if (decodeNode(n, decoder) === target) hits.push(n);
    }
  });
  if (hits.length !== 1) {
    const detail = hits.map((h) => `${h.type}@${h.start}-${h.end}`).join(', ');
    throw new Error(`Expected exactly one ${opts.label ?? target} match, found ${hits.length}: ${detail}`);
  }
  return hits[0];
}

function patchCliJs(file, cfg, rpt) {
  const presets = cfg.providerPresets ?? cfg.managedProviders;
  if (!cfg.seedProviderPresets || !presets?.providers?.length) {
    rpt.patches.cliProviderPresetSeeder = { skipped: true, reason: 'seedProviderPresets disabled or no provider presets configured' };
    return;
  }
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('CCURSOR_COMPANY_PROVIDER_PRESET_SEEDER')) {
    rpt.patches.cliProviderPresetSeeder = { skipped: true, reason: 'already patched' };
    return;
  }
  const beforeBytes = src.length;
  const seederName = signature.name;
  const snippet = `
;/* CCURSOR_COMPANY_PROVIDER_PRESET_SEEDER */
(()=>{try{const preset=${JSON.stringify(presets)};const signer=${JSON.stringify(seederName)};function clone(v){return JSON.parse(JSON.stringify(v))}function seed(){const fs=require("fs"),path=require("path"),os=require("os");const home=(os.homedir&&os.homedir())||process.env.USERPROFILE||process.env.HOME;if(!home)return;const dir=path.join(home,".ccursor");fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,"providers.json");let doc={ $schemaVersion:preset.$schemaVersion||1, providers:[] };if(fs.existsSync(file)){try{doc=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}}if(!doc||typeof doc!=="object")doc={ $schemaVersion:preset.$schemaVersion||1, providers:[] };if(!Array.isArray(doc.providers))doc.providers=[];doc.$schemaVersion=doc.$schemaVersion||preset.$schemaVersion||1;const byId=new Map(doc.providers.filter(p=>p&&p.id).map(p=>[p.id,p]));for(const p of preset.providers||[]){const existing=byId.get(p.id);const next=clone(p);if(existing){const oldKey=existing.auth&&typeof existing.auth==="object"?existing.auth.value:undefined;if(oldKey)next.auth={...(next.auth||{}),value:oldKey};Object.assign(existing,next)}else doc.providers.push(next)}fs.writeFileSync(file,JSON.stringify(doc,null,2)+"\\n");console.log("[company-preset] providers.json seeded/merged for "+signer)}process.on("exit",(code)=>{try{const args=process.argv.slice(2).map(String);if(code===0&&args.includes("install"))seed()}catch(e){try{console.warn("[company-preset] provider seed failed:",e&&e.message?e.message:e)}catch{}}})}catch(e){}})();
`;
  const shebangMatch = src.match(/^#!.*\r?\n/);
  if (shebangMatch) src = shebangMatch[0] + snippet + src.slice(shebangMatch[0].length);
  else src = snippet + src;
  fs.writeFileSync(file, src);
  rpt.patches.cliProviderPresetSeeder = {
    mode: 'merge-provider-presets-after-successful-install',
    beforeBytes,
    afterBytes: src.length,
    providerCount: presets.providers.length
  };
}

function summarizeFn(fn) { return { name: fn.name, start: fn.start, end: fn.end, length: fn.end - fn.start, matched: fn.matched }; }

function findFunctionByStrings(ast, src, decoder, strings, opts = {}) {
  const minMatches = opts.minMatches ?? strings.length;
  const hits = [];
  walk.simple(ast, {
    FunctionDeclaration(node) {
      const found = decodedStringsInNode(node, decoder);
      const matched = strings.filter((s) => found.has(s));
      if (matched.length >= minMatches) hits.push({ node, name: node.id?.name, start: node.start, end: node.end, matched });
    }
  });
  if (hits.length === 0 && opts.optional) return null;
  if (hits.length !== 1) {
    const detail = hits.map((h) => `${h.name}@${h.start}[${h.matched.join('|')}]`).join(', ');
    throw new Error(`Expected exactly one ${opts.label ?? 'function'} match, found ${hits.length}: ${detail}`);
  }
  return hits[0];
}

function decodedStringsInNode(node, decoder) {
  const out = new Set();
  walk.simple(node, {
    Literal(n) { if (typeof n.value === 'string') out.add(n.value); },
    CallExpression(n) { const d = decodeNode(n, decoder); if (typeof d === 'string') out.add(d); },
    MemberExpression(n) { const d = decodeNode(n, decoder); if (typeof d === 'string') out.add(d); }
  });
  return out;
}

function decodeNode(n, decoder) {
  if (!n) return undefined;
  if (n.type === 'Literal') return n.value;
  if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'Vyazt1') {
    const val = decodeArgValue(n.arguments[0], decoder);
    try { return decoder.decode(val); } catch { return undefined; }
  }
  if (n.type === 'MemberExpression' && n.object.type === 'Identifier' && n.object.name === 'gvQ2P56') {
    if (n.computed && n.property.type === 'Literal') return decoder.arr[n.property.value];
  }
  return undefined;
}

function decodeArgValue(arg, decoder) {
  if (!arg) return undefined;
  if (arg.type === 'Literal') return arg.value;
  if (arg.type === 'MemberExpression' && arg.object.type === 'Identifier' && arg.object.name === 'gvQ2P56' && arg.computed && arg.property.type === 'Literal') return decoder.arr[arg.property.value];
  return undefined;
}

function buildExtensionDecoder(src) {
  const preEnd = src.indexOf('qvicbj(fQ4YPip={},kgsu5p0=D01lbsr([');
  if (preEnd < 0) throw new Error('extension string decoder anchor not found');
  const hyStart = src.indexOf('function HY5ZkD');
  const hyEnd = src.indexOf('okySdhv=wI1cNAy()', hyStart);
  if (hyStart < 0 || hyEnd < 0) throw new Error('extension decoder function range not found');
  const initStart = preEnd;
  let quote = null, esc = false, stack = [], initEnd = -1;
  for (let j = initStart; j < src.length; j++) {
    const ch = src[j];
    if (quote) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) quote = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '(') stack.push(ch);
      else if (ch === ')') {
        stack.pop();
        if (!stack.length) { initEnd = j + 1; break; }
      }
    }
  }
  if (initEnd < 0) throw new Error('extension decoder init call end not found');
  const decStart = src.indexOf(';function L_yg2x');
  if (decStart < 0) throw new Error('extension decoder helper not found');
  const code = src.slice(0, preEnd) + 'function qvicbj(){qvicbj=function(){}};' + src.slice(initStart, initEnd) + src.slice(decStart, hyEnd) + '; globalThis.__decode=Vyazt1; globalThis.__arr=gvQ2P56;';
  const sandbox = { console, TextDecoder, Uint8Array, Buffer, String, Array };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 20000 });
  return { decode: sandbox.__decode, arr: sandbox.__arr };
}


function runNpm(args, cwd) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  }
  return execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

