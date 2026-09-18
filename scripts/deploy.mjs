import {deployEnv, deployedTag, resolveConfig} from '../lib/config.mjs';
import {error, group, setOutput, summary}      from '../lib/core.mjs';
import {runCommandLine}                        from '../lib/exec.mjs';
import {moveTag}                               from '../lib/github.mjs';
import {failureMessage}                        from '../lib/inputs.mjs';
import {deploymentOrder}                       from '../lib/regions.mjs';
import {summaryDeployed, summaryFailed}        from '../lib/report.mjs';

/**
 * Deploys a serverless stack to every region the stage spans, then moves the
 * tag that records what the stage is running.
 *
 * Two things about the shape of this are deliberate. Every region the stage
 * spans is deployed in one run, so a change cannot land in one and not the
 * other and leave the two drifting; and the tag moves only after all of them
 * have finished, because a tag moved halfway through would claim a deployment
 * that half the stack never received.
 */

/**
 * Deploys, then records.
 *
 * @return {Promise<void>}
 */
async function main() {
  const config = resolveConfig();
  if (config.cwd !== '.') {
    process.chdir(config.cwd);
  }

  const plan = deploymentOrder(config);
  console.log(
    plan.secondary
      ? `${config.stage} spans ${plan.regions.join(' and ')}.`
      : `${config.stage} is single-region: no ${config.secondaryRegionVariable} is set for it.`
  );
  console.log(`Deploying ${config.stage} to ${plan.regions.join(', ')}.`);

  if (config.install) {
    await group('Install dependencies', () => runCommandLine(config.installCommand));
  }

  const deployed = [];
  for (const region of plan.regions) {
    try {
      await group(`deploy — ${config.stage} / ${region}`, () => runCommandLine(
        config.deployCommand,
        ['--stage', config.stage, '--region', region, ...config.deployArgs],
        {env: deployEnv(config, plan.secondary)}
      ));
    } catch (thrown) {
      await summary(summaryFailed(config, deployed, region));
      await publish({outcome: 'failed', deployed, config, tag: {moved: false, tag: deployedTag(config)}});
      throw thrown;
    }
    deployed.push(region);
  }

  const tag = await recordDeployment(config);
  await summary(summaryDeployed(config, plan, tag));
  await publish({outcome: 'passed', deployed, config, tag});
}

/**
 * Moves the tag that records what the stage is running.
 *
 * Bookkeeping only — a failure is reported and never fatal, because the
 * deployment it records has already succeeded and failing the run would send
 * somebody to repair something that is not broken.
 *
 * @param {object} config Resolved configuration
 * @return {Promise<{ moved: boolean, tag: string, sha: string }>} What the tag records
 */
async function recordDeployment(config) {
  const tag = deployedTag(config);
  if (!config.moveTag || !config.sha) {
    return {moved: false, tag, sha: config.sha};
  }

  const moved = await moveTag(tag, config.sha);
  if (moved) {
    console.log(`Moved ${tag} to ${config.sha}.`);
  }
  return {moved, tag, sha: config.sha};
}

/**
 * Publishes the action's outputs.
 *
 * @param {{ outcome: string, deployed: string[], config: object, tag: { moved: boolean, tag: string, sha?: string } }} result What the run did
 * @return {Promise<void>}
 */
async function publish({outcome, deployed, config, tag}) {
  await setOutput('outcome', outcome);
  await setOutput('stage', config.stage);
  await setOutput('regions', deployed.join(','));
  await setOutput('tag', tag.tag);
  await setOutput('deployed-sha', tag.moved ? tag.sha : '');
}

try {
  await main();
} catch (thrown) {
  error(failureMessage(thrown));
  await setOutput('outcome', 'failed');
  process.exitCode = 1;
}
