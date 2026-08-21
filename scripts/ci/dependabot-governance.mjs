const allowedDependencyFilesByEcosystem = new Map([
  [
    'npm_and_yarn',
    [
      /(?:^|\/)package\.json$/,
      /(?:^|\/)package-lock\.json$/,
      /(?:^|\/)npm-shrinkwrap\.json$/,
      /(?:^|\/)yarn\.lock$/,
      /(?:^|\/)pnpm-lock\.yaml$/,
    ],
  ],
  ['docker', [/(?:^|\/)Dockerfile(?:\.[^/]+)?$/]],
  ['github_actions', [/^\.github\/workflows\/[^/]+\.ya?ml$/]],
  ['maven', [/(?:^|\/)pom\.xml$/]],
  [
    'pip',
    [/(?:^|\/)requirements[^/]*\.txt$/, /(?:^|\/)pyproject\.toml$/, /(?:^|\/)uv\.lock$/, /(?:^|\/)Pipfile(?:\.lock)?$/],
  ],
  [
    'gradle',
    [
      /(?:^|\/)build\.gradle(?:\.kts)?$/,
      /(?:^|\/)settings\.gradle(?:\.kts)?$/,
      /(?:^|\/)gradle\.properties$/,
      /(?:^|\/)gradle\/wrapper\/gradle-wrapper\.properties$/,
      /(?:^|\/)gradle\/libs\.versions\.toml$/,
      /(?:^|\/)variables\.gradle$/,
    ],
  ],
]);

export function isTrustedDependabotManifestUpdate({
  authorLogin,
  headRefName,
  headRepositoryFullName,
  repoFullName,
  changedFiles,
  changedFileModes,
  allowedEcosystems,
}) {
  const ecosystem = headRefName?.match(/^dependabot\/([^/]+)\//)?.[1];
  const allowedPatterns = allowedDependencyFilesByEcosystem.get(ecosystem);

  return (
    authorLogin === 'dependabot[bot]' &&
    headRepositoryFullName === repoFullName &&
    Array.isArray(changedFiles) &&
    changedFiles.length > 0 &&
    Boolean(allowedPatterns) &&
    allowedEcosystems instanceof Set &&
    allowedEcosystems.has(ecosystem) &&
    changedFileModes instanceof Map &&
    changedFiles.every(
      (relativePath) =>
        changedFileModes.get(relativePath) === '100644' &&
        allowedPatterns.some((pattern) => pattern.test(relativePath)),
    )
  );
}
