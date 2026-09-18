import {writeFileSync}                                  from 'node:fs';
import {afterEach, describe, it}                         from 'node:test';
import assert                                            from 'node:assert/strict';
import {deployEnv, deployedTag, parseEnv, resolveConfig} from '../lib/config.mjs';
import {ConfigError}                                     from '../lib/inputs.mjs';
import {deploymentOrder, mainRegion, ORDERS, resolveRegions} from '../lib/regions.mjs';
import {summaryDeployed, summaryFailed}                  from '../lib/report.mjs';

/**
 * Which regions are deployed, in which order, and what the tag ends up saying.
 *
 * The order is the part that looks arbitrary and is not: a resource the main
 * region owns can name something only the other region's stack creates, so the
 * secondary region goes first.
 */

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  }
  delete process.env.SECONDARY_REGION;
  delete process.env.GITHUB_SHA;
});

const base = {
  configFile: 'test/fixtures/serverless.yml',
  mainRegionKey: 'mainRegion',
  regions: [],
  secondaryRegion: '',
  onlyRegion: '',
  order: 'secondary-first'
};

describe('mainRegion', () => {
  it('reads the region out of the configuration, so the two cannot disagree', () => {
    assert.equal(mainRegion({...base, mainRegion: ''}), 'us-east-1');
  });

  it('refuses with advice when there is nothing to read it from', () => {
    assert.throws(
      () => mainRegion({...base, mainRegion: '', configFile: 'nowhere.yml'}),
      (thrown) => {
        assert.ok(thrown instanceof ConfigError);
        assert.match(thrown.message, /`main-region`/);
        return true;
      }
    );
  });

  it('takes the key name from the caller', () => {
    const path = 'test/fixtures/other-key.yml';
    writeFileSync(path, 'custom:\n  primaryRegion: eu-central-1\n');
    assert.equal(
      mainRegion({...base, mainRegion: '', configFile: path, mainRegionKey: 'primaryRegion'}),
      'eu-central-1'
    );
  });
});

describe('resolveRegions', () => {
  it('is the main region alone for a single-region stage', () => {
    assert.deepEqual(resolveRegions({...base, mainRegion: 'us-east-1'}), {
      main: 'us-east-1',
      secondary: '',
      all: ['us-east-1']
    });
  });

  it('spans both when the stage has a second region', () => {
    assert.deepEqual(resolveRegions({...base, mainRegion: 'us-east-1', secondaryRegion: 'us-west-1'}), {
      main: 'us-east-1',
      secondary: 'us-west-1',
      all: ['us-east-1', 'us-west-1']
    });
  });

  it('lets an explicit region list win, treating the first as the main one', () => {
    assert.deepEqual(resolveRegions({...base, regions: ['eu-west-1', 'eu-central-1']}), {
      main: 'eu-west-1',
      secondary: 'eu-central-1',
      all: ['eu-west-1', 'eu-central-1']
    });
  });

  it('refuses a secondary region that is already the main one', () => {
    assert.throws(
      () => resolveRegions({...base, mainRegion: 'us-east-1', secondaryRegion: 'us-east-1'}),
      /already the main region/
    );
  });
});

describe('deploymentOrder', () => {
  const twoRegions = {...base, mainRegion: 'us-east-1', secondaryRegion: 'us-west-1'};

  it('deploys the secondary region first and the main region last', () => {
    // A resource the main region owns can name something only the other
    // region's stack creates, and CloudFormation refuses to create it while
    // that thing is missing.
    assert.deepEqual(deploymentOrder(twoRegions).regions, ['us-west-1', 'us-east-1']);
  });

  it('reverses that for a caller whose dependencies run the other way', () => {
    assert.deepEqual(
      deploymentOrder({...twoRegions, order: 'main-first'}).regions,
      ['us-east-1', 'us-west-1']
    );
  });

  it('leaves an explicit list in the order it was given', () => {
    assert.deepEqual(
      deploymentOrder({...base, regions: ['a', 'b', 'c'], order: 'as-listed'}).regions,
      ['a', 'b', 'c']
    );
  });

  it('narrows to one region for repair work', () => {
    assert.deepEqual(deploymentOrder({...twoRegions, onlyRegion: 'us-east-1'}).regions, ['us-east-1']);
  });

  it('refuses a region the stage does not span, listing the ones it does', () => {
    // Deploying to a region the stage has no template for creates a stack
    // nothing will ever update again.
    assert.throws(() => deploymentOrder({...twoRegions, onlyRegion: 'eu-west-1'}), (thrown) => {
      assert.ok(thrown instanceof ConfigError);
      assert.match(thrown.message, /not one this stage spans \(us-east-1, us-west-1\)/);
      return true;
    });
  });

  it('is one region for a single-region stage', () => {
    assert.deepEqual(deploymentOrder({...base, mainRegion: 'us-east-1'}).regions, ['us-east-1']);
  });

  it('names every order it accepts', () => {
    assert.deepEqual(ORDERS, ['secondary-first', 'main-first', 'as-listed']);
  });
});

describe('resolveConfig', () => {
  it('refuses to guess at a stage', () => {
    // A deployment goes somewhere specific; a default here would be a
    // deployment to the wrong place.
    assert.throws(() => resolveConfig(), (thrown) => {
      assert.ok(thrown instanceof ConfigError);
      assert.match(thrown.message, /`stage` input is required/);
      return true;
    });
  });

  it('reads the secondary region from the variable the configuration reads', () => {
    process.env.INPUT_STAGE = 'staging';
    process.env.SECONDARY_REGION = 'us-west-1';
    assert.equal(resolveConfig().secondaryRegion, 'us-west-1');
  });

  it('lets the input win over that variable', () => {
    process.env.INPUT_STAGE = 'staging';
    process.env.SECONDARY_REGION = 'us-west-1';
    process.env.INPUT_SECONDARY_REGION = 'eu-west-1';
    assert.equal(resolveConfig().secondaryRegion, 'eu-west-1');
  });

  it('looks up the variable the caller named, not the default one', () => {
    process.env.INPUT_STAGE = 'staging';
    process.env.INPUT_SECONDARY_REGION_VARIABLE = 'REPLICA_REGION';
    process.env.REPLICA_REGION = 'ap-south-1';
    assert.equal(resolveConfig().secondaryRegion, 'ap-south-1');
    delete process.env.REPLICA_REGION;
  });

  it('refuses an unknown order', () => {
    process.env.INPUT_STAGE = 'staging';
    process.env.INPUT_ORDER = 'alphabetical';
    assert.throws(() => resolveConfig(), /Unknown `order` "alphabetical"/);
  });

  it('defaults the commit to the one being run', () => {
    process.env.INPUT_STAGE = 'staging';
    process.env.GITHUB_SHA = 'a'.repeat(40);
    assert.equal(resolveConfig().sha, 'a'.repeat(40));
  });

  it('defaults to a verbose osls deploy', () => {
    process.env.INPUT_STAGE = 'staging';
    const config = resolveConfig();
    assert.equal(config.deployCommand, 'npx osls deploy');
    assert.deepEqual(config.deployArgs, ['--verbose']);
  });
});

describe('deployEnv', () => {
  const config = {secondaryRegionVariable: 'SECONDARY_REGION', extraEnv: {HOSTED_ZONE_ID: 'Z1'}};

  it('sets the secondary-region variable for every region of the run, empty included', () => {
    assert.equal(deployEnv(config, '').SECONDARY_REGION, '');
    assert.equal(deployEnv(config, 'us-west-1').SECONDARY_REGION, 'us-west-1');
  });

  it('carries the caller\'s own variables', () => {
    assert.equal(deployEnv(config, '').HOSTED_ZONE_ID, 'Z1');
  });
});

describe('parseEnv', () => {
  it('reads KEY=value entries and keeps a value containing an equals sign', () => {
    assert.deepEqual(parseEnv(['A=1', 'B=x=y', 'nonsense']), {A: '1', B: 'x=y'});
  });
});

describe('deployedTag', () => {
  it('composes the prefix and the stage', () => {
    assert.equal(deployedTag({tagPrefix: 'ci/deployed', stage: 'staging', tag: ''}), 'ci/deployed/staging');
  });

  it('lets an explicit tag win', () => {
    assert.equal(deployedTag({tagPrefix: 'ci/deployed', stage: 'staging', tag: 'live'}), 'live');
  });
});

describe('the summaries', () => {
  const config = {stage: 'production', secondaryRegionVariable: 'SECONDARY_REGION'};

  it('table every region that landed and where the tag ended up', () => {
    const summary = summaryDeployed(
      config,
      {regions: ['us-west-1', 'us-east-1'], secondary: 'us-west-1'},
      {moved: true, tag: 'ci/deployed/production', sha: 'a'.repeat(40)}
    );
    assert.match(summary, /^## :rocket: Deployed production/);
    assert.match(summary, /\| `us-west-1` \| :white_check_mark: deployed \|/);
    assert.match(summary, /spans two regions/);
    assert.match(summary, /`ci\/deployed\/production` now points at `aaaaaaa`/);
  });

  it('say plainly when a stage is single-region', () => {
    const summary = summaryDeployed(
      config,
      {regions: ['us-east-1'], secondary: ''},
      {moved: false, tag: 'ci/deployed/production', sha: ''}
    );
    assert.match(summary, /single-region/);
    assert.match(summary, /tag was left alone/);
  });

  it('warn that a half-finished multi-region run left the stage inconsistent', () => {
    // The first thing somebody needs to know, because the stage is drifting
    // until it is repaired.
    const summary = summaryFailed(config, ['us-west-1'], 'us-east-1');
    assert.match(summary, /^## :x: Deployment of production failed in `us-east-1`/);
    assert.match(summary, /`us-west-1` was deployed before the failure/);
    assert.match(summary, /now inconsistent across its regions/);
    assert.match(summary, /tag was not moved/);
  });

  it('do not claim inconsistency when the first region was the one that failed', () => {
    const summary = summaryFailed(config, [], 'us-west-1');
    assert.equal(summary.includes('inconsistent'), false);
    assert.match(summary, /tag was not moved/);
  });
});
