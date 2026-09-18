# aws-deploy-action

Deploys a serverless stack to **every region a stage spans**, in dependency
order, and moves the tag that records what the stage is running.

```yaml
permissions:
  contents: write        # the run moves a tag

steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0

  - uses: aws-actions/configure-aws-credentials@v6
    with:
      role-to-assume: ${{ vars.AWS_OIDC_ROLE_ARN }}
      aws-region: ${{ vars.AWS_MAIN_REGION }}

  - uses: malyavi/aws-deploy-action@v1
    with:
      stage: staging
      secondary-region: ${{ vars.SECONDARY_REGION }}
```

Credentials are the caller's business — configure them however you already do,
with OIDC or with keys, before this step. Built for
[osls](https://github.com/oss-serverless/serverless), and `deploy-command`
points it at anything that takes `--stage` and `--region`.

## The two decisions it exists to hold

**Every region together.** A change that lands in one region and not the other
leaves the two drifting apart, which is the state nobody notices until a
failover. So one run deploys all of them, and `only-region` — which refuses a
region the stage does not span — is for bringing a region up or repairing one,
not for ordinary use.

**The secondary region first.** A resource the main region owns can name
something only the other region's stack creates: a global table's replica
pointing at a KMS alias, for instance. CloudFormation refuses to create or
extend it while that alias is missing, so the region the stack is built around
goes **last**. A caller whose dependencies run the other way says
`order: main-first`.

## The tag

A successful run moves `ci/deployed/<stage>` to the commit it deployed, so
`git describe` and the compare view can answer "what is actually running in
staging". It moves only after **every** region has finished — a tag moved
halfway through would claim a deployment that half the stack never received —
and a failure leaves it alone, still recording the last complete deployment.

A half-finished multi-region run says so in the job summary, and names the
regions that did land, because that is the first thing somebody needs: the stage
is inconsistent until it is repaired.

## `stage` has no default

A deployment goes somewhere specific, and a stage this action guessed at would
be a deployment to the wrong place. Map your branch to a stage in the workflow,
or take it from a dispatch input:

```yaml
- uses: malyavi/aws-deploy-action@v1
  with:
    stage: ${{ inputs.stage || (github.ref_name == 'main' && 'staging') || '' }}
```

## Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `stage` | **required** | The stage to deploy. |
| `regions` | derived | The regions to deploy, comma-separated, overriding everything below. The first is treated as the main one. |
| `main-region` | from the config file | The region the stack is built around. |
| `main-region-key` | `mainRegion` | The key it is read from, under `custom:`. |
| `secondary-region` | the variable below | The stage's second region, if it has one. |
| `secondary-region-variable` | `SECONDARY_REGION` | The variable the configuration reads it from; set for every region of the run. |
| `only-region` | — | Deploy one region of the stage. A region it does not span is refused. |
| `order` | `secondary-first` | Also `main-first` or `as-listed`. |
| `config-file` | `serverless.yml` | Read for the main region; never parsed as YAML. |
| `install` | `true` | Whether to install dependencies first. |
| `install-command` | `npm ci` | How to install them. |
| `deploy-command` | `npx osls deploy` | `--stage` and `--region` are appended, then `deploy-args`. |
| `deploy-args` | `--verbose` | Extra arguments for it. |
| `extra-env` | — | `KEY=value` entries the configuration resolves at deploy time. |
| `move-tag` | `true` | Whether to move the deployment tag. |
| `tag-prefix` | `ci/deployed` | The stage is appended to it. |
| `tag` | — | The full tag name, when prefix and stage do not compose it. |
| `sha` | `github.sha` | The commit the tag should record. |
| `label` | `Deployment` | How the run names itself. |
| `working-directory` | `.` | Directory holding the configuration. |
| `github-token` | `github.token` | Moves the tag; needs `contents: write`. |

## Outputs

| Output | What it holds |
| --- | --- |
| `outcome` | `passed` or `failed`. |
| `stage` | The stage that was deployed. |
| `regions` | The regions that **finished**, comma-separated and in deployment order. |
| `tag` | The tag this run used. |
| `deployed-sha` | The commit the tag now records — empty when it did not move. |

`regions` names what finished rather than what was attempted, so a later step
can act on a partial deployment.

## Concurrency

One deployment per stage at a time, queued rather than cancelled: killing the
runner mid-deploy leaves CloudFormation still rolling forward with nobody
watching it.

```yaml
concurrency:
  group: deploy-${{ inputs.stage || 'staging' }}
  cancel-in-progress: false
```

## Validating before deploying

`malyavi/aws-osls-action` synthesizes and lints every template shape this action
would deploy, without credentials. Run it on the pull request; run this on the
merge.

## Development

```bash
npm test                           # unit suite, no dependencies
python3 test/check-action-yaml.py  # action.yml parses and maps every input
```

The smoke job drives the action with a stand-in deployer that asserts the
contract this action owns and logs the region it was called for, so the
deployment order, the refusals and the half-finished multi-region case are all
exercised — with nothing deployed and no tag moved. Whether `osls deploy` can
deploy is the caller's tool doing the caller's job, and it needs an AWS account
to answer.
