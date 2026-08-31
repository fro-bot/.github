/**
 * Pure private-repository disclosure detector. The request-time GitHub adapter
 * belongs outside this module and supplies only the authority list.
 */
export function checkPrivateLeak(privateNames, diff, override) {
    if (override.titlePrefixed && override.isOperator) {
        return { ok: true };
    }
    if (privateNames.length === 0 || diff.length === 0) {
        return { ok: true };
    }
    const lowerNames = privateNames.map(name => name.toLowerCase());
    const matchedFiles = [];
    let currentFile = null;
    let checkPathAsNew = false;
    const checkPath = (path) => {
        const pathLower = path.toLowerCase();
        if (lowerNames.some(name => pathLower.includes(name)) && !matchedFiles.includes(path)) {
            matchedFiles.push(path);
        }
    };
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git a/')) {
            const diffPrefix = 'diff --git a/';
            const separator = ' b/';
            // Index scanning, not a regex: the original `/^diff --git a\/.+ b\/(.+)$/` backtracked on
            // caller-supplied diff text. Keep this branch regex-free -- no timing guard covers it (#3810).
            // The old regex selected the rightmost separator with at least one trailing character.
            const separatorIndex = line.lastIndexOf(separator, line.length - separator.length - 1);
            if (separatorIndex > diffPrefix.length && separatorIndex + separator.length < line.length) {
                const bPath = line.slice(separatorIndex + separator.length);
                const aPath = line.slice(diffPrefix.length, separatorIndex);
                currentFile = bPath;
                checkPathAsNew = false;
                if (aPath !== bPath) {
                    checkPath(bPath);
                }
            }
            else {
                currentFile = null;
                checkPathAsNew = false;
            }
            continue;
        }
        if (line.startsWith('rename to ') || line.startsWith('copy to ')) {
            const destination = line.startsWith('rename to ')
                ? line.slice('rename to '.length)
                : line.slice('copy to '.length);
            if (destination !== '') {
                checkPath(destination);
            }
            continue;
        }
        if (line.startsWith('--- ')) {
            checkPathAsNew = line === '--- /dev/null';
            continue;
        }
        if (line.startsWith('+++')) {
            if (checkPathAsNew && currentFile !== null) {
                checkPath(currentFile);
            }
            checkPathAsNew = false;
            continue;
        }
        if (!line.startsWith('+')) {
            continue;
        }
        const content = line.slice(1).toLowerCase();
        if (currentFile !== null &&
            lowerNames.some(name => content.includes(name)) &&
            !matchedFiles.includes(currentFile)) {
            matchedFiles.push(currentFile);
        }
    }
    return matchedFiles.length === 0 ? { ok: true } : { ok: false, matchedFiles };
}
export async function checkPrivateLeakWithAdapter(adapter, request) {
    const privateNames = await adapter.resolvePrivateRepositoryNames({
        content: request.content,
        snapshotSha: request.snapshotSha,
    });
    return checkPrivateLeak(privateNames, request.diff, request.override);
}
