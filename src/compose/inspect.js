import fs from 'node:fs';
import path from 'node:path';

/**
 * Small scanner over a compose file to find:
 *   - service names
 *   - hard-coded `container_name:` entries
 *   - which services have a `build:` block
 *   - each built service's build-context path (relative)
 *   - which services declare host-published `ports:`
 *
 * Returns:
 *   {
 *     serviceNames: string[],
 *     containerNames: Record<string,string>,
 *     builtServices: Set<string>,
 *     buildContexts: Record<string,string>,
 *     servicesWithPorts: Set<string>,
 *   }
 */
export function inspectComposeFile(repoRoot, fileName) {
  const file = path.join(repoRoot, fileName);
  const empty = {
    serviceNames: [],
    containerNames: {},
    builtServices: new Set(),
    buildContexts: {},
    servicesWithPorts: new Set(),
  };
  if (!fs.existsSync(file)) return empty;

  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch { return empty; }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  let inServices = false;
  let servicesIndent = -1;
  let currentService = null;
  let inBuildBlock = false;

  const serviceNames = [];
  const containerNames = {};
  const builtServices = new Set();
  const buildContexts = {};
  const servicesWithPorts = new Set();

  for (const raw of lines) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trimEnd();

    if (!inServices) {
      if (/^services:\s*$/.test(raw)) {
        inServices = true;
        servicesIndent = indent;
      }
      continue;
    }

    if (indent <= servicesIndent && raw.trim() !== '') break;

    if (indent === servicesIndent + 2) {
      const m = line.match(/^\s*([A-Za-z0-9_.-]+):\s*$/);
      currentService = m ? m[1] : null;
      inBuildBlock = false;
      if (currentService) serviceNames.push(currentService);
      continue;
    }

    if (!currentService) continue;

    if (indent >= servicesIndent + 4) {
      const cn = line.match(/^\s*container_name:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/);
      if (cn) containerNames[currentService] = cn[1];

      const bStr = line.match(/^\s*build:\s*(\.\/[^\s#]+|\.)\s*(?:#.*)?$/);
      if (bStr) {
        builtServices.add(currentService);
        buildContexts[currentService] = bStr[1];
        inBuildBlock = false;
        continue;
      }

      if (/^\s*build:\s*$/.test(line)) {
        builtServices.add(currentService);
        inBuildBlock = true;
        continue;
      }

      const ctx = line.match(/^\s*context:\s*(\.\/[^\s#]+|\.)\s*(?:#.*)?$/);
      if (ctx && inBuildBlock) {
        buildContexts[currentService] = ctx[1];
        continue;
      }

      // ports:  — either inline (`ports: ["5000:5000"]`) or block form (`ports:` on its own)
      if (/^\s*ports:\s*/.test(line)) {
        servicesWithPorts.add(currentService);
      }

      if (inBuildBlock && indent <= servicesIndent + 4) {
        inBuildBlock = false;
      }
    }
  }

  return { serviceNames, containerNames, builtServices, buildContexts, servicesWithPorts };
}