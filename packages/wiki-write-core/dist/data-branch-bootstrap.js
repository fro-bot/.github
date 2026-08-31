import process from 'node:process';
const DEFAULT_OWNER = 'fro-bot';
const DEFAULT_REPO = '.github';
const DEFAULT_MAIN_BRANCH = 'main';
const DEFAULT_DATA_BRANCH = 'data';
const DEFAULT_RESTORE_MESSAGE = 'chore(data): restore data branch';
const FRO_BOT_BOT_AUTHOR = {
    name: 'fro-bot[bot]',
    email: '109017866+fro-bot[bot]@users.noreply.github.com',
};
export class DataBranchBootstrapError extends Error {
    code;
    remediation;
    constructor(params) {
        super(params.message);
        this.name = 'DataBranchBootstrapError';
        this.code = params.code;
        this.remediation = params.remediation;
    }
}
export async function bootstrapDataBranch(params = {}) {
    const owner = params.owner ?? DEFAULT_OWNER;
    const repo = params.repo ?? DEFAULT_REPO;
    const mainBranch = params.mainBranch ?? DEFAULT_MAIN_BRANCH;
    const dataBranch = params.dataBranch ?? DEFAULT_DATA_BRANCH;
    const octokit = params.octokit ?? (await createOctokitFromEnv());
    try {
        const existing = await octokit.rest.repos.getBranch({ owner, repo, branch: dataBranch });
        return {
            created: false,
            ref: `refs/heads/${existing.data.name}`,
            sha: existing.data.commit.sha,
        };
    }
    catch (error) {
        if (!isApiErrorStatus(error, 404)) {
            throw toBootstrapApiError(error, `checking whether ${dataBranch} exists`);
        }
    }
    let main;
    try {
        main = await octokit.rest.repos.getBranch({ owner, repo, branch: mainBranch });
    }
    catch (error) {
        if (isApiErrorStatus(error, 404)) {
            throw new DataBranchBootstrapError({
                code: 'MAIN_BRANCH_NOT_FOUND',
                message: `Cannot bootstrap ${dataBranch}: base branch ${mainBranch} was not found in ${owner}/${repo}`,
                remediation: `Create or restore the ${mainBranch} branch before bootstrapping the ${dataBranch} branch.`,
            });
        }
        throw toBootstrapApiError(error, `reading ${mainBranch} branch head`);
    }
    let baseCommit;
    try {
        baseCommit = await octokit.rest.git.getCommit({ owner, repo, commit_sha: main.data.commit.sha });
    }
    catch (error) {
        throw toBootstrapApiError(error, `reading ${mainBranch} commit tree`);
    }
    let restoreCommit;
    try {
        restoreCommit = await octokit.rest.git.createCommit({
            owner,
            repo,
            message: DEFAULT_RESTORE_MESSAGE,
            tree: baseCommit.data.tree.sha,
            parents: [main.data.commit.sha],
            author: FRO_BOT_BOT_AUTHOR,
            committer: FRO_BOT_BOT_AUTHOR,
        });
    }
    catch (error) {
        throw toBootstrapApiError(error, `creating ${dataBranch} restore commit`);
    }
    try {
        const response = await octokit.rest.git.createRef({
            owner,
            repo,
            ref: `refs/heads/${dataBranch}`,
            sha: restoreCommit.data.sha,
        });
        return {
            created: true,
            ref: response.data.ref,
            sha: restoreCommit.data.sha,
        };
    }
    catch (error) {
        if (isApiErrorStatus(error, 422)) {
            let existing;
            try {
                existing = await octokit.rest.repos.getBranch({ owner, repo, branch: dataBranch });
            }
            catch (raceLookupError) {
                throw toBootstrapApiError(raceLookupError, `creating ${dataBranch} from ${mainBranch}`);
            }
            return {
                created: false,
                ref: `refs/heads/${existing.data.name}`,
                sha: existing.data.commit.sha,
            };
        }
        throw toBootstrapApiError(error, `creating ${dataBranch} from ${mainBranch}`);
    }
}
async function createOctokitFromEnv() {
    const token = process.env.GITHUB_TOKEN;
    if (token === undefined || token === '') {
        throw new DataBranchBootstrapError({
            code: 'MISSING_TOKEN',
            message: 'bootstrapDataBranch requires params.octokit or GITHUB_TOKEN in the environment',
            remediation: 'Pass an authenticated Octokit via params.octokit, or export GITHUB_TOKEN before invocation.',
        });
    }
    const Octokit = await loadOctokitConstructor();
    return new Octokit({ auth: token });
}
async function loadOctokitConstructor() {
    const loaded = await import('@octokit/rest');
    if (!isRecord(loaded) || !('Octokit' in loaded)) {
        throw new DataBranchBootstrapError({
            code: 'OCTOKIT_LOAD_FAILED',
            message: 'Failed to load @octokit/rest Octokit constructor',
            remediation: 'Verify @octokit/rest is installed and its export surface has not changed.',
        });
    }
    const octokit = loaded.Octokit;
    if (typeof octokit !== 'function') {
        throw new TypeError('Invalid @octokit/rest Octokit export');
    }
    return octokit;
}
function toBootstrapApiError(error, action) {
    const message = error instanceof Error ? error.message : `Unknown error while ${action}`;
    return new DataBranchBootstrapError({
        code: 'API_ERROR',
        message: `GitHub API error while ${action}: ${message}`,
        remediation: 'Retry once. If the failure persists, inspect the repository permissions and GitHub API status.',
    });
}
function isApiErrorStatus(error, status) {
    return isRecord(error) && typeof error.status === 'number' && error.status === status;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export async function runDataBranchBootstrapCli() {
    const result = await bootstrapDataBranch();
    const action = result.created ? 'created' : 'exists';
    process.stdout.write(`${action}:${result.ref}:${result.sha}\n`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
    await runDataBranchBootstrapCli();
}
