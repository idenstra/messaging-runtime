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
  ['github_actions', [/^\.github\/workflows\/[^/]+\.ya?ml$/, /^\.github\/actions\/.+\/action\.ya?ml$/]],
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
    ],
  ],
]);

export function isTrustedDependabotManifestUpdate({
  authorLogin,
  headRefName,
  headRepositoryFullName,
  repoFullName,
  changedFiles,
}) {
  const ecosystem = headRefName?.match(/^dependabot\/([^/]+)\//)?.[1];
  const allowedPatterns = allowedDependencyFilesByEcosystem.get(ecosystem);

  return (
    authorLogin === 'dependabot[bot]' &&
    headRepositoryFullName === repoFullName &&
    Array.isArray(changedFiles) &&
    changedFiles.length > 0 &&
    Boolean(allowedPatterns) &&
    changedFiles.every((relativePath) => allowedPatterns.some((pattern) => pattern.test(relativePath)))
  );
}
