import { rule as coreBoundariesRule } from "./core-boundaries.mjs";
import { rule as featureCoreImportsRule } from "./feature-core-imports.mjs";
import { rule as featureBoundariesRule } from "./feature-boundaries.mjs";
import { rule as featureLayerPurityRule } from "./architecture/feature-layer-purity.mjs";
import { rule as coreRootStateImportsRule } from "./architecture/core-root-state-imports.mjs";
import { rule as maxFilesPerDirectoryRule } from "./max-files-per-directory.mjs";
import { rule as maxLocRule } from "./budgets/max-loc.mjs";
import { rule as coreLayerStructureBudgetRule } from "./budgets/core-layer-structure-budget.mjs";
import { rule as coreNodeImportsBudgetRule } from "./budgets/core-node-imports-budget.mjs";
import { rule as coreProcessEnvBudgetRule } from "./budgets/core-process-env-budget.mjs";
import { rule as stateBoundariesRule } from "./state-boundaries.mjs";
import { rule as cliCommanderOptionsRule } from "./cli-commander-options.mjs";
import { rule as surfaceCommandPurityRule } from "./surface-command-purity.mjs";
import { rule as domainNoCrossDomainRule } from "./domain-no-cross-domain.mjs";
import { rule as boundaryJsonParseRule } from "./boundary-json-parse.mjs";
import { rule as coreLayerPurityRule } from "./core-layer-purity.mjs";
import { rule as coreRootFreezeRule } from "./core-root-freeze.mjs";
import { rule as coreDomainRootFreezeRule } from "./architecture/core-domain-root-freeze.mjs";
import { rule as coreProvidersImportsRule } from "./architecture/core-providers-imports.mjs";
import { rule as coreLayerDirectionRule } from "./architecture/core-layer-direction.mjs";
import { rule as featureLayerDirectionRule } from "./architecture/feature-layer-direction.mjs";
import { rule as publicSurfaceCurationRule } from "./architecture/public-surface-curation.mjs";
import { rule as tsNoExplicitAnyRule } from "./typescript/no-explicit-any.mjs";

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
  [coreDomainRootFreezeRule.name, coreDomainRootFreezeRule],
  [coreProvidersImportsRule.name, coreProvidersImportsRule],
  [coreLayerDirectionRule.name, coreLayerDirectionRule],
  [featureLayerDirectionRule.name, featureLayerDirectionRule],
  [publicSurfaceCurationRule.name, publicSurfaceCurationRule],
  [maxFilesPerDirectoryRule.name, maxFilesPerDirectoryRule],
  [maxLocRule.name, maxLocRule],
  [coreLayerStructureBudgetRule.name, coreLayerStructureBudgetRule],
  [coreNodeImportsBudgetRule.name, coreNodeImportsBudgetRule],
  [coreProcessEnvBudgetRule.name, coreProcessEnvBudgetRule],
  [tsNoExplicitAnyRule.name, tsNoExplicitAnyRule],
]);
