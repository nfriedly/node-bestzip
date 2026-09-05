# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add option to not follow symlinks (`--no-follow-sym-links` / `followSymLinks: false`) ([#100](https://github.com/nfriedly/node-bestzip/pull/100))
- Warn when `followSymLinks` is not explicitly set and symlinks are detected, as the default will change in v4 ([#103](https://github.com/nfriedly/node-bestzip/pull/103))
- Add compression `-N` CLI shorthand flags, throw on invalid compression levels ([#102](https://github.com/nfriedly/node-bestzip/pull/102))

### Changed

- Parallelize filesystem operations

### Fixed

- Resolved issue where nodeZip default symlink behavior didn't match native zip for top-level symlinks ([#101](https://github.com/nfriedly/node-bestzip/pull/101))

## [3.0.3] - 2026-08-28

### Security

- Prevent native zip destination from being interpreted as a flag ([#99](https://github.com/nfriedly/node-bestzip/pull/99))

## [3.0.2] - 2026-08-06

### Security

- Ensure input files can't be treated as command line flags ([#97](https://github.com/nfriedly/node-bestzip/pull/97) / [GHSA-p87m-9567-rgcc](https://github.com/nfriedly/node-bestzip/security/advisories/GHSA-p87m-9567-rgcc))

## [3.0.1] - 2026-05-21

### Changed

- Update archiver dependency ([#89](https://github.com/nfriedly/node-bestzip/pull/89))

## [3.0.0] - 2026-05-19

### Changed

- Migrate from CommonJS (CJS) to ESM ([#88](https://github.com/nfriedly/node-bestzip/pull/88))

## [2.2.5] - 2026-05-15

### Removed

- Remove unused `regenerator-runtime` dependency ([#85](https://github.com/nfriedly/node-bestzip/pull/85))

## [2.2.4] - 2026-05-15

### Changed

- Update minimum Node.js version to v20 ([#84](https://github.com/nfriedly/node-bestzip/pull/84))

## [2.2.3] - 2026-03-25

### Changed

- Upgrade glob and other dependencies

## [2.2.2] - 2026-03-20

### Changed

- Migrate CI from Travis CI to GitHub Actions
- Publish with `--provenance`

### Fixed

- Add compression level to readme

## [2.2.1] - 2022-04-13

### Added

- Add option to set level of compression (`--level` / `level`) ([#52](https://github.com/nfriedly/node-bestzip/pull/52))
- Default compression level for native zip ([#53](https://github.com/nfriedly/node-bestzip/pull/53))

## [2.2.0] - 2021-03-18

### Changed

- Update dependencies to latest versions ([#43](https://github.com/nfriedly/node-bestzip/pull/43))

### Added

- Performance test to compare node to native zip
- Test for command injection

## [2.1.7] - 2020-09-01

### Fixed

- Prevent shell command injection

## [2.1.6] - 2020-07-27

### Fixed

- Follow linked folders when zipping ([#36](https://github.com/nfriedly/node-bestzip/pull/36))

## [2.1.5] - 2019-10-18

### Fixed

- Ignore stderr message if no native zip ([#33](https://github.com/nfriedly/node-bestzip/pull/33))

### Changed

- Reduce published package size

## [2.1.4] - 2019-05-15

### Changed

- Only publish source code, not tests

## [2.1.3] - 2019-05-15

### Changed

- Drop support for Node.js 6 and remove Babel
- Update supported (tested) Node.js versions

## [2.1.2] - 2018-10-12

### Changed

- Update npm packages for compliance ([#24](https://github.com/nfriedly/node-bestzip/pull/24))

## [2.1.1] - 2018-09-11

### Fixed

- Work around archiver bug with adding directories on Windows

## [2.1.0] - 2018-09-10

### Added

- New promise-based API that accepts a `cwd` option
- Wildcard support

## [2.0.0] - 2018-08-27

### Changed

- `bestzip output.zip foo/bar/file.txt` now includes the `foo/bar/` folders; previously `file.txt` was placed at the top-level. This was done to more closely align with the native zip command.
- Update archiver to v3.0.0
- Use glob rather than deprecated `.bulk`
- Use `.directory` instead of `.bulk`

## [1.1.6] - 2018-08-23

### Changed

- Roll archiver back to a version that supports bulk and add additional tests
- Test on Node.js 6, automatically publish from Travis CI

## [1.1.5] - 2018-08-21

### Changed

- Bring modules up to date, fix security issues in older archiver module
- Add ESLint and Prettier
- Add AppVeyor config for Windows CI

### Fixed

- Exclude the destination zip file from being added to itself ([#8](https://github.com/nfriedly/node-bestzip/pull/8))

## [1.1.4] - 2017-03-20

### Fixed

- Zip files starting with a dot ([#4](https://github.com/nfriedly/node-bestzip/pull/4))

## [1.1.3] - 2016-01-29

### Changed

- Update package.json ([#3](https://github.com/nfriedly/node-bestzip/pull/3))

## [1.1.2] - 2015-07-03

### Fixed

- Correct order of destination & source params in readme ([#2](https://github.com/nfriedly/node-bestzip/pull/2))

## [1.1.1] - 2014-11-05

### Fixed

- Improved error handling

## [1.1.0] - 2014-10-28

### Added

- Support for multiple source files

## [1.0.1] - 2014-10-28

### Fixed

- Ensure `folder/*` works on Windows
