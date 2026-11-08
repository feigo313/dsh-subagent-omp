/**
 * Type-shape JSDoc imports for the vendored out-of-process helpers. Values
 * live in `out-of-process.js`; this module only documents the contracts.
 *
 * @module dsh-subagent-omp/vendor/types
 */

/**
 * @typedef {Object} SubagentCapabilities
 * @property {boolean} agentOptions
 * @property {boolean} agentPreset
 * @property {boolean} outputSchema
 * @property {boolean} depthLimit
 */

/**
 * @typedef {Object} SubagentResult
 * @property {readonly unknown[]} output
 * @property {unknown} [structured]
 * @property {string} [diagnostic]
 * @property {string} stopReason
 */

/**
 * @typedef {Object} RunResultSettlement
 * @property {() => Promise<SubagentResult>} attempt
 * @property {() => readonly unknown[]} collectOutput
 * @property {(() => string | undefined) | undefined} [collectDiagnostic]
 * @property {() => boolean} cancelled
 * @property {((error: Error, stopReason: string) => void) | undefined} [onError]
 * @property {AbortSignal} signal
 * @property {() => void} onAbort
 */

/**
 * @typedef {Object} SubprocessRunHandleParts
 * @property {string} id
 * @property {Promise<SubagentResult>} result
 * @property {AbortSignal} signal
 * @property {() => void} onAbort
 * @property {() => void} requestCancel
 * @property {() => Promise<void>} teardown
 */

/**
 * @typedef {Object} SubagentRun
 * @property {string} id
 * @property {Promise<SubagentResult>} result
 * @property {() => Promise<void>} dispose
 */

export {};
