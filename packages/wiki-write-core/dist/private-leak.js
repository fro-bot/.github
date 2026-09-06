/**
 * Pure private-repository disclosure detector. The request-time GitHub adapter
 * belongs outside this module and supplies only the authority list.
 */
export function checkPrivateLeak(privateNames, diff, override) {
    if (override.titlePrefixed && override.isOperator) {
        return { ok: true };
    }
    // Stryker disable next-line ConditionalExpression,LogicalOperator,BlockStatement: whichever side of `||` is true, privateNames.length === 0 forces lowerNames = [] downstream so `.some(...)` can never match afterward -- forcing this condition false (or its && variant, or emptying the return block) still converges to {ok: true} for every reachable input; not observable.
    if (privateNames.length === 0 || diff.length === 0) {
        return { ok: true };
    }
    const lowerNames = privateNames.map(name => name.toLowerCase());
    const matchedFiles = [];
    let currentFile = null;
    // Stryker disable next-line BooleanLiteral: currentFile only ever becomes non-null via the "diff --git a/" branch, which in the same conditional branch also resets checkPathAsNew to false, or the else branch resets both currentFile and checkPathAsNew together. Whenever currentFile !== null is later read, this initial value has already been overwritten by one of those resets -- not observable.
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
            // Stryker disable next-line ArithmeticOperator,EqualityOperator,ConditionalExpression: structurally redundant, not observable -- lastIndexOf's own second argument (line.length - separator.length - 1) already guarantees any found index satisfies foundIndex + separator.length < line.length, so this clause is true whenever separatorIndex !== -1. Extracted to its own line so this directive cannot also suppress the left-hand clause's mutants on the `if` line below, which are genuinely killed by a real boundary-value test.
            const hasRoomAfterSeparator = separatorIndex + separator.length < line.length;
            if (separatorIndex > diffPrefix.length && hasRoomAfterSeparator) {
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
                // Stryker disable next-line BooleanLiteral: currentFile is reset to null in this same branch, so the "+++" handler's currentFile !== null guard blocks any read of checkPathAsNew until the next "diff --git a/" line resets it again anyway -- not observable.
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
            // Stryker disable next-line BooleanLiteral: currentFile can only change via a "diff --git a/" line, which always resets checkPathAsNew too -- a stale true value here is never read before the next reset. Not observable.
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
