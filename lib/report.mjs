/**
 * What a reader is told. A deployment has no pull request to comment on, so
 * everything goes to the job summary — which is the record of what is running
 * where, read after the fact rather than during.
 */

/**
 * The summary for a successful run.
 *
 * @param {object} config Resolved configuration
 * @param {{ regions: string[], secondary: string }} plan What was deployed, and whether the stage spans two regions
 * @param {{ moved: boolean, tag: string, sha: string }} tag What the tag now records
 * @return {string} Markdown
 */
export function summaryDeployed(config, plan, tag) {
  return [
    `## :rocket: Deployed ${config.stage}`,
    '',
    '| Region | Result |',
    '| --- | --- |',
    ...plan.regions.map((region) => `| \`${region}\` | :white_check_mark: deployed |`),
    '',
    plan.secondary
      ? `The stage spans two regions (\`${config.secondaryRegionVariable}=${plan.secondary}\`), ` +
        'and both are deployed together so they cannot drift apart.'
      : `The stage is single-region: \`${config.secondaryRegionVariable}\` is not set for it.`,
    tag.moved
      ? `\`${tag.tag}\` now points at \`${tag.sha.slice(0, 7)}\`.`
      : 'The deployment tag was left alone.'
  ].join('\n');
}

/**
 * The summary for a run that failed partway.
 *
 * Which regions did land is the first thing somebody needs, because a
 * multi-region stage that failed halfway is drifting until it is repaired.
 *
 * @param {object} config Resolved configuration
 * @param {string[]} deployed Regions that finished
 * @param {string} failed The region that did not
 * @return {string} Markdown
 */
export function summaryFailed(config, deployed, failed) {
  const lines = [
    `## :x: Deployment of ${config.stage} failed in \`${failed}\``,
    '',
    '| Region | Result |',
    '| --- | --- |',
    ...deployed.map((region) => `| \`${region}\` | :white_check_mark: deployed |`),
    `| \`${failed}\` | :x: failed |`,
    ''
  ];

  if (deployed.length > 0) {
    lines.push(
      `:warning: \`${deployed.join('`, `')}\` ` +
      `${deployed.length === 1 ? 'was' : 'were'} deployed before the failure, so this stage is ` +
      'now inconsistent across its regions. Repair it by re-running the deployment once the ' +
      'cause is fixed.',
      ''
    );
  }
  lines.push('The deployment tag was not moved, so it still records the last complete deployment.');
  return lines.join('\n');
}
