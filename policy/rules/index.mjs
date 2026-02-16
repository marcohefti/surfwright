import { rule as coreBoundariesRule } from "./core-boundaries.mjs";
import { rule as featureCoreImportsRule } from "./feature-core-imports.mjs";
import { rule as featureBoundariesRule } from "./feature-boundaries.mjs";
import { rule as featureLayerPurityRule } from "./architecture/feature-layer-purity.mjs";
import { rule as coreRootStateImportsRule } from "./architecture/core-root-state-imports.mjs";
import { rule as maxFilesPerDirectoryRule } from "./max-files-per-directory.mjs";
import { rule as maxLocRule } from "./budgets/max-loc.mjs";
import { rule as stateBoundariesRule } from "./state-boundaries.mjs";
import { rule as cliCommanderOptionsRule } from "./cli-commander-options.mjs";
import { rule as surfaceCommandPurityRule } from "./surface-command-purity.mjs";
import { rule as domainNoCrossDomainRule } from "./domain-no-cross-domain.mjs";
import { rule as boundaryJsonParseRule } from "./boundary-json-parse.mjs";
import { rule as coreLayerPurityRule } from "./core-layer-purity.mjs";
import { rule as coreRootFreezeRule } from "./core-root-freeze.mjs";

export const ruleRegistry = new Map([
  [featureBoundariesRule.name, featureBoundariesRule],
  [featureCoreImportsRule.name, featureCoreImportsRule],
  [featureLayerPurityRule.name, featureLayerPurityRule],
  [coreRootStateImportsRule.name, coreRootStateImportsRule],
  [coreBoundariesRule.name, coreBoundariesRule],
  [stateBoundariesRule.name, stateBoundariesRule],
  [cliCommanderOptionsRule.name, cliCommanderOptionsRule],
  [surfaceCommandPurityRule.name, surfaceCommandPurityRule],
  [domainNoCrossDomainRule.name, domainNoCrossDomainRule],
  [boundaryJsonParseRule.name, boundaryJsonParseRule],
  [coreLayerPurityRule.name, coreLayerPurityRule],
  [coreRootFreezeRule.name, coreRootFreezeRule],
  [maxFilesPerDirectoryRule.name, maxFilesPerDirectoryRule],
  [maxLocRule.name, maxLocRule],
]);
