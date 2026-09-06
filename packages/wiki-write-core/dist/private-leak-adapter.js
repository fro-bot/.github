import { Buffer } from 'node:buffer';
import { Octokit } from '@octokit/rest';
import { parse } from 'yaml';
import { checkPrivateLeakWithAdapter, } from "./private-leak.js";
import { assertReposFile } from "./schemas.js";
import { buildPrivateNameTokens } from "./wiki-slug.js";
const DEFAULT_OWNER = 'fro-bot';
const DEFAULT_REPO = '.github';
const DEFAULT_BRANCH = 'data';
const METADATA_PATH = 'metadata/repos.yaml';
const PRIVATE_REPOSITORIES_QUERY = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Repository {
        nameWithOwner
        isPrivate
      }
    }
  }
`;
export class PrivateLeakAdapterError extends Error {
    code;
    remediation;
    constructor(params) {
        super(params.message);
        this.name = 'PrivateLeakAdapterError';
        this.code = params.code;
        this.remediation = params.remediation;
    }
}
/**
 * Build a request-time adapter backed by the authoritative data-branch
 * metadata. The adapter never reads workflow event state or process env.
 */
export async function createGitHubPrivateLeakAdapter(params = {}) {
    const octokit = params.octokit ?? createOctokit(params.token);
    const owner = params.owner ?? DEFAULT_OWNER;
    const repo = params.repo ?? DEFAULT_REPO;
    const branch = params.branch ?? DEFAULT_BRANCH;
    const resolutionCache = new Map();
    return {
        resolvePrivateRepositoryNames: async () => {
            const metadata = await readPrivateMetadata(octokit, owner, repo, branch);
            const cached = resolutionCache.get(metadata.sha);
            if (cached !== undefined)
                return cached;
            const resolution = resolvePrivateRepositoryNames(octokit, metadata.nodeIds);
            resolutionCache.set(metadata.sha, resolution);
            try {
                return await resolution;
            }
            catch (error) {
                resolutionCache.delete(metadata.sha);
                throw error;
            }
        },
    };
}
/**
 * Scan candidate content with the GitHub-backed privacy adapter. Callers may
 * reuse an adapter to cache resolution by the metadata blob SHA, or provide
 * only a token and the request content.
 */
export async function checkPrivateLeakWithGitHub(request) {
    const adapter = request.adapter ??
        (await createGitHubPrivateLeakAdapter({
            token: request.token,
            octokit: request.octokit,
        }));
    return checkPrivateLeakWithAdapter(adapter, request);
}
function createOctokit(token) {
    if (token === undefined || token === '') {
        throw new PrivateLeakAdapterError({
            code: 'MISSING_TOKEN',
            message: 'Request-time privacy scanning requires an explicit GitHub token or Octokit client',
            remediation: 'Pass token or octokit to checkPrivateLeakWithGitHub; workflow environment is not used.',
        });
    }
    try {
        return new Octokit({ auth: token });
    }
    catch (error) {
        throw new PrivateLeakAdapterError({
            code: 'OCTOKIT_INIT_FAILED',
            message: `Failed to initialize the GitHub client: ${error instanceof Error ? error.message : String(error)}`,
            remediation: 'Verify the GitHub token and @octokit/rest installation before retrying the privacy scan.',
        });
    }
}
async function readPrivateMetadata(octokit, owner, repo, branch) {
    let response;
    try {
        response = await octokit.rest.repos.getContent({ owner, repo, path: METADATA_PATH, ref: branch });
    }
    catch {
        throw new PrivateLeakAdapterError({
            code: 'METADATA_UNAVAILABLE',
            message: `Unable to read authoritative ${METADATA_PATH}`,
            remediation: `Verify access to ${owner}/${repo}@${branch} and retry the privacy scan.`,
        });
    }
    const payload = response.data;
    if (!isRecord(payload) || payload.type !== 'file' || typeof payload.sha !== 'string' || payload.sha === '') {
        throw new PrivateLeakAdapterError({
            code: 'METADATA_UNAVAILABLE',
            message: `Authoritative ${METADATA_PATH} was not returned as a file with a blob SHA`,
            remediation: `Restore ${METADATA_PATH} on ${owner}/${repo}@${branch} before retrying the privacy scan.`,
        });
    }
    if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
        throw new PrivateLeakAdapterError({
            code: 'METADATA_UNAVAILABLE',
            message: `Authoritative ${METADATA_PATH} did not contain decodable content`,
            remediation: `Verify the GitHub Contents API response for ${METADATA_PATH} and retry.`,
        });
    }
    let parsed;
    try {
        const yamlText = Buffer.from(payload.content.replaceAll(/\s/g, ''), 'base64').toString('utf8');
        parsed = parse(yamlText);
        assertReposFile(parsed);
    }
    catch {
        throw new PrivateLeakAdapterError({
            code: 'METADATA_INVALID',
            message: `Authoritative ${METADATA_PATH} is absent or invalid`,
            remediation: `Repair the schema of ${METADATA_PATH} on ${owner}/${repo}@${branch} before retrying.`,
        });
    }
    const privateEntries = parsed.repos.filter(entry => entry.private === true);
    const nodeIds = privateEntries.flatMap(entry => typeof entry.node_id === 'string' && entry.node_id !== '' ? [entry.node_id] : []);
    if (nodeIds.length !== privateEntries.length) {
        throw new PrivateLeakAdapterError({
            code: 'RESOLUTION_FAILED',
            message: 'Authoritative metadata contains private entries without resolvable node IDs',
            remediation: 'Repair every private metadata entry with a valid node_id before retrying the privacy scan.',
        });
    }
    return { sha: payload.sha, nodeIds };
}
async function resolvePrivateRepositoryNames(octokit, nodeIds) {
    if (nodeIds.length === 0)
        return [];
    let response;
    try {
        response = await octokit.graphql(PRIVATE_REPOSITORIES_QUERY, { ids: nodeIds });
    }
    catch {
        throw new PrivateLeakAdapterError({
            code: 'RESOLUTION_FAILED',
            message: 'GitHub could not resolve the authoritative private repository identities',
            remediation: 'Verify token visibility and GitHub API availability, then retry the privacy scan.',
        });
    }
    const nodes = isRecord(response) ? response.nodes : undefined;
    if (!Array.isArray(nodes) || nodes.length !== nodeIds.length) {
        throw new PrivateLeakAdapterError({
            code: 'RESOLUTION_FAILED',
            message: 'GitHub returned an incomplete private repository resolution response',
            remediation: 'Verify token visibility for every private repository and retry the privacy scan.',
        });
    }
    const names = [];
    for (const node of nodes) {
        if (!isRecord(node) || typeof node.nameWithOwner !== 'string' || node.nameWithOwner === '') {
            throw new PrivateLeakAdapterError({
                code: 'RESOLUTION_FAILED',
                message: 'GitHub could not resolve every authoritative private repository identity',
                remediation: 'Verify token visibility for every private repository and retry the privacy scan.',
            });
        }
        if ('isPrivate' in node && node.isPrivate !== true) {
            throw new PrivateLeakAdapterError({
                code: 'RESOLUTION_FAILED',
                message: 'GitHub returned a non-private repository for an authoritative private entry',
                remediation: 'Reconcile metadata visibility before retrying the privacy scan.',
            });
        }
        names.push(...buildPrivateNameTokens(node.nameWithOwner));
    }
    return names;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
