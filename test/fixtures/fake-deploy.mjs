import {appendFile} from 'node:fs/promises';

/**
 * A stand-in for `osls deploy`, for the smoke test.
 *
 * It stands in for the deployer and for nothing else: it **asserts the
 * contract** the action is responsible for — that `--stage` and `--region`
 * arrive, that the caller's own arguments follow them, and that the
 * secondary-region variable is set — and then appends the region to a log so
 * the test can assert the *order* they were deployed in.
 *
 * `FAKE_FAIL_REGION` makes it refuse one region, which is how the
 * half-finished multi-region run is exercised without anything being deployed
 * anywhere.
 */

const args = process.argv.slice(2);

/**
 * The value of a named argument.
 *
 * @param {string} name Argument name, with its dashes
 * @return {string|undefined} The value that followed it
 */
function valueOf(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/**
 * Fails the run with a message the smoke job's log will carry.
 *
 * @param {string} message What was wrong
 * @return {never}
 */
function refuse(message) {
  console.error(`fake-deploy: ${message}`);
  console.error(`fake-deploy: argv was ${JSON.stringify(args)}`);
  process.exit(1);
}

const stage = valueOf('--stage');
const region = valueOf('--region');

if (!stage) {
  refuse('the action did not pass --stage');
}
if (!region) {
  refuse('the action did not pass --region');
}
if (!args.includes('--verbose')) {
  refuse('the caller\'s own deploy-args did not arrive');
}
if (process.env.SECONDARY_REGION === undefined) {
  refuse('SECONDARY_REGION was not set; it must be set for every region of the run');
}

await appendFile(
  process.env.FAKE_DEPLOY_LOG || 'deployed.log',
  `${region} stage=${stage} secondary=${process.env.SECONDARY_REGION || 'none'}\n`
);
console.log(`fake-deploy: ${stage}/${region} (secondary="${process.env.SECONDARY_REGION}")`);

if (process.env.FAKE_FAIL_REGION === region) {
  refuse(`asked to fail in ${region}`);
}
