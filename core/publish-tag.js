// A PRERELEASE MUST NOT REACH `latest`, AND npm WILL NOT STOP IT.
//
// MEASURED, npm 11.8.0: `publishConfig: { tag: 'beta' }` is in the manifest of every package here, and
// `npm publish --dry-run` still announces `with tag latest`. The flag is what decides, so the manifest cannot be the
// guard -- and a bare `npm publish` of `0.1.0-beta.1` would make the BETA the version `npm i <package>` installs,
// which is the one outcome the prerelease version exists to prevent.
//
// The workflow passes `--tag beta` explicitly, so this is the guard for the other path: a maintainer publishing by
// hand. It is wired into `prepublishOnly`, where npm exposes the resolved tag as `npm_config_tag`.
/**
 * @param version the package version about to be published
 * @param tag     the tag npm resolved (`''` means it resolved none, which is `latest`)
 * @returns a message when publishing would misfile the version, else `null`
 */
export function publishTagProblem({ version = '', tag = '' } = {}) {
    const text = String(version).trim()
    const chosen = String(tag).trim() === '' ? 'latest' : String(tag).trim()
    // ONLY THE DANGEROUS DIRECTION IS REFUSED. A stable version published to a `beta` tag is unusual but deliberate
    // when it happens, and a guard that refused it would be a guard somebody works around.
    if (text.includes('-') && chosen === 'latest') {
        return `${text} is a PRERELEASE and would be published to \`latest\`, so \`npm i <this package>\` would install`
            + ' it. npm ignores `publishConfig.tag` (measured on npm 11.8.0), so the tag must be passed:'
            + ' `npm publish --tag beta`.'
    }
    return null
}
