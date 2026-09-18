import {readFileSync} from 'node:fs';
import {ConfigError}  from './inputs.mjs';

/**
 * Which regions a stage spans, and in which order they are deployed.
 *
 * **The order is load-bearing where it looks most arbitrary.** A resource in
 * one region can name something only the other region's stack creates — a
 * global table's replica pointing at a KMS alias, for instance — and
 * CloudFormation refuses to create or extend it while that thing is missing.
 * So the secondary region goes first and the region the stack is built around
 * goes last, and a caller whose dependencies run the other way says so with
 * `order`.
 *
 * Both regions always deploy together. A change that landed in one and not the
 * other leaves the two drifting apart, which is the state nobody notices until
 * a failover.
 */

/** How the regions are ordered. */
export const ORDERS = ['secondary-first', 'main-first', 'as-listed'];

/**
 * The region the configuration is built around.
 *
 * Read out of the configuration file when the caller names none, so the file
 * and the deployment cannot disagree about it. Never parsed as YAML: the file
 * is full of `${...}` that no plain parser resolves.
 *
 * @param {{ mainRegion: string, configFile: string, mainRegionKey: string }} config Resolved configuration
 * @return {string} The main region
 * @throws {ConfigError} When neither the input nor the file supplies one
 */
export function mainRegion({mainRegion: named, configFile, mainRegionKey}) {
  if (named) {
    return named;
  }

  let text;
  try {
    text = readFileSync(configFile, 'utf8');
  } catch {
    throw new ConfigError(
      `No \`main-region\` given and ${configFile} could not be read. Pass the region, ` +
      'or point `config-file` at the configuration.'
    );
  }

  const found = text.match(new RegExp(`^\\s+${mainRegionKey}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
  if (!found) {
    throw new ConfigError(
      `No \`main-region\` given and no \`${mainRegionKey}:\` in ${configFile}. Pass the region, ` +
      `or add \`${mainRegionKey}:\` under the file's \`custom:\` block.`
    );
  }
  return found;
}

/**
 * Every region the stage spans.
 *
 * @param {object} config Resolved configuration
 * @return {{ main: string, secondary: string, all: string[] }} The main region, the secondary or '' when there is none, and every region
 * @throws {ConfigError} When the secondary region is the main one
 */
export function resolveRegions(config) {
  if (config.regions.length > 0) {
    const [main, ...rest] = config.regions;
    return {main, secondary: rest[0] ?? '', all: config.regions};
  }

  const main = mainRegion(config);
  const secondary = config.secondaryRegion;

  if (secondary === main) {
    throw new ConfigError(
      `The secondary region is "${secondary}", which is already the main region. ` +
      'Leave it blank for a single-region stage.'
    );
  }
  return {main, secondary, all: secondary ? [main, secondary] : [main]};
}

/**
 * The regions to deploy, in the order to deploy them.
 *
 * @param {object} config Resolved configuration
 * @return {{ regions: string[], main: string, secondary: string }} The regions in deployment order, and which is which
 * @throws {ConfigError} When `only-region` names a region the stage does not span
 */
export function deploymentOrder(config) {
  const {main, secondary, all} = resolveRegions(config);
  const only = config.onlyRegion;

  if (only) {
    if (!all.includes(only)) {
      throw new ConfigError(
        `Region "${only}" is not one this stage spans (${all.join(', ')}). ` +
        'A second region is added with the `secondary-region` input, or by the variable the ' +
        'configuration reads it from.'
      );
    }
    return {regions: [only], main, secondary};
  }

  if (config.order === 'as-listed') {
    return {regions: all, main, secondary};
  }
  if (config.order === 'main-first') {
    return {regions: [main, ...all.filter((region) => region !== main)], main, secondary};
  }
  // secondary-first: the region the stack is built around goes last, because a
  // resource it owns can name something only the other region's stack creates.
  return {regions: [...all.filter((region) => region !== main), main], main, secondary};
}
