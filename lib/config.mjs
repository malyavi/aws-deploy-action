import {argsInput, booleanInput, ConfigError, input, listInput} from './inputs.mjs';
import {ORDERS}                                                 from './regions.mjs';

/**
 * The action's inputs, resolved into one object.
 */

/**
 * Resolves every input.
 *
 * @return {object} Resolved configuration
 * @throws {ConfigError} When an input is missing or malformed
 */
export function resolveConfig() {
  // No default, unlike every other input here: a deployment goes somewhere, and
  // a stage this action guessed at is a deployment to the wrong place.
  const stage = input('stage');
  if (!stage) {
    throw new ConfigError(
      'The `stage` input is required. A deployment goes somewhere specific, so this action will ' +
      'not guess at it — map your branch to a stage in the workflow, or take it from a dispatch input.'
    );
  }

  const order = input('order', 'secondary-first');
  if (!ORDERS.includes(order)) {
    throw new ConfigError(`Unknown \`order\` "${order}"; expected one of ${ORDERS.join(', ')}.`);
  }

  const secondaryRegionVariable = input('secondary-region-variable', 'SECONDARY_REGION');

  return {
    stage,
    order,
    regions: listInput('regions'),
    onlyRegion: input('only-region'),
    mainRegion: input('main-region'),
    mainRegionKey: input('main-region-key', 'mainRegion'),
    // Falls back to the variable the configuration itself reads, so a stage
    // whose environment sets it needs nothing passed here.
    secondaryRegion: input('secondary-region', process.env[secondaryRegionVariable] ?? ''),
    secondaryRegionVariable,
    configFile: input('config-file', 'serverless.yml'),
    install: booleanInput('install', true),
    installCommand: input('install-command', 'npm ci'),
    deployCommand: input('deploy-command', 'npx osls deploy'),
    deployArgs: argsInput('deploy-args', ['--verbose']),
    extraEnv: parseEnv(listInput('extra-env')),
    moveTag: booleanInput('move-tag', true),
    tagPrefix: input('tag-prefix', 'ci/deployed'),
    tag: input('tag'),
    sha: input('sha', process.env.GITHUB_SHA ?? ''),
    label: input('label', 'Deployment'),
    cwd: input('working-directory', '.')
  };
}

/**
 * Reads the extra variables a caller passes, as `KEY=value` lines.
 *
 * @param {string[]} entries The `KEY=value` entries
 * @return {Record<string, string>} The environment to add
 */
export function parseEnv(entries) {
  const env = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index > 0) {
      env[entry.slice(0, index).trim()] = entry.slice(index + 1).trim();
    }
  }
  return env;
}

/**
 * The environment one region is deployed with.
 *
 * The secondary-region variable is set for every region of the run, so the
 * template resolves the same way it did when it was validated — and so a value
 * left over in the runner cannot make a single-region stage deploy a replica.
 *
 * @param {object} config Resolved configuration
 * @param {string} secondary The stage's secondary region, or '' when it has none
 * @return {Record<string, string>} The environment for this deployment
 */
export function deployEnv(config, secondary) {
  return {
    ...config.extraEnv,
    [config.secondaryRegionVariable]: secondary
  };
}

/**
 * The tag that records what a stage is running.
 *
 * @param {object} config Resolved configuration
 * @return {string} Tag name, without the `refs/tags/` prefix
 */
export function deployedTag(config) {
  return config.tag || `${config.tagPrefix}/${config.stage}`;
}
