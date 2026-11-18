/**
 * Metro has to look outside this folder.
 *
 * `@onepass/pass` is a file dependency on ../packages/pass, so npm installs it
 * as a symlink pointing out of the project root. Metro resolves and watches
 * within the project by default and would not follow it, so the QR encoder —
 * the one this repository already has, rather than a second one from npm —
 * has to be pointed at explicitly.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(repoRoot, 'packages/pass')];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(repoRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
