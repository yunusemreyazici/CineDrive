import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Offline check for the documentation syntax used here: inline links/images,
// explicit/collapsed references, HTML href/src, ATX and HTML headings, and IDs.
// This is deliberately not a general Markdown renderer or external URL crawler.
function prose(source) {
  let fence;
  return source
    .replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) fence = undefined;
        return '';
      }
      if (marker) {
        fence = marker[1];
        return '';
      }
      return line;
    })
    .join('\n');
}

function slug(text) {
  return text
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[*`]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '')
    .replace(/\s/g, '-');
}

function anchors(source) {
  const result = new Set();
  const headings = new Set();
  const text = prose(source);
  for (const match of text.matchAll(
    /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$|<h[1-6]\b[^>]*>(.*?)<\/h[1-6]>/gim,
  )) {
    const base = slug(match[1] ?? match[2]);
    let id = base;
    for (let n = 1; headings.has(id); n++) id = `${base}-${n}`;
    headings.add(id);
    result.add(id);
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}

const referenceKey = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();

function links(source) {
  const text = prose(source).replace(/(`+)[^\n]*?\1/g, (s) => ' '.repeat(s.length));
  const references = new Map();
  const found = [];
  const add = (target, index, missingReference) =>
    found.push({
      target,
      missingReference,
      line: text.slice(0, index).split('\n').length,
    });
  for (const match of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    references.set(referenceKey(match[1]), match[2] ?? match[3]);
    add(match[2] ?? match[3], match.index);
  }
  // One nested parenthesis is enough for repository paths; angle destinations
  // support spaces. Optional Markdown titles are not part of the destination.
  for (const match of text.matchAll(
    /\]\(\s*(?:<([^>]+)>|((?:[^\s()]|\([^()]*\))*))(?:\s+["'][^\n]*?["'])?\s*\)/g,
  )) {
    add(match[1] ?? match[2], match.index);
  }
  for (const match of text.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) add(match[1], match.index);
  for (const match of text.matchAll(/\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
    const key = referenceKey(match[2] || match[1]);
    add(references.get(key) ?? key, match.index, !references.has(key));
  }
  return found;
}

export function checkDocumentation(root) {
  root = resolve(root);
  const files = [];
  function collect(dir, recursive) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isFile() && extname(path) === '.md') files.push(path);
      else if (recursive && entry.isDirectory()) collect(path, true);
    }
  }
  collect(root, false);
  if (existsSync(resolve(root, 'docs'))) collect(resolve(root, 'docs'), true);
  const errors = [];
  const anchorCache = new Map();
  let checked = 0;
  for (const file of files.sort()) {
    for (const link of links(readFileSync(file, 'utf8'))) {
      const fail = (reason) =>
        errors.push(`${relative(root, file)}:${link.line}: ${reason}: ${link.target}`);
      if (link.missingReference) {
        fail('undefined reference');
        continue;
      }
      if (!link.target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link.target)) continue;
      checked++;
      let path, fragment;
      try {
        const hash = link.target.indexOf('#');
        path = decodeURIComponent(
          (hash < 0 ? link.target : link.target.slice(0, hash)).split('?')[0],
        );
        fragment = hash < 0 ? '' : decodeURIComponent(link.target.slice(hash + 1));
      } catch {
        fail('invalid URL encoding');
        continue;
      }
      const target = path ? resolve(dirname(file), path) : file;
      const withinRoot = relative(root, target);
      if (withinRoot === '..' || withinRoot.startsWith('../') || isAbsolute(withinRoot)) {
        fail('target is outside repository');
        continue;
      }
      if (!existsSync(target)) {
        fail('missing file');
        continue;
      }
      if (fragment && extname(target) === '.md' && statSync(target).isFile()) {
        if (!anchorCache.has(target))
          anchorCache.set(target, anchors(readFileSync(target, 'utf8')));
        if (!anchorCache.get(target).has(fragment)) fail('missing heading or anchor');
      }
    }
  }
  return { files: files.length, checked, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = checkDocumentation(process.cwd());
  if (result.errors.length) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `Documentation links OK: ${result.checked} local links in ${result.files} Markdown files (external URLs skipped).`,
    );
  }
}
