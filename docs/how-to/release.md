# Releasing

> Part of the [pi-hooks documentation](../README.md). Publish a version from CI with trusted publishing.


Versions are published from CI, not from a laptop. Once the package has a trusted publisher
configured on npmjs.com (GitHub Actions, repository `killo3967/pi-hooks`, workflow `publish.yml`,
with *Allow npm publish* enabled):

```bash
npm version patch   # or minor / major: bumps package.json and creates the tag
 git push --follow-tags
```

The tag triggers `.github/workflows/publish.yml`, which runs the checks and publishes with OIDC
short-lived credentials (plus provenance attestations). No npm token is stored in the repository.
Pushing a tag whose version is already on the registry is a no-op, so re-tags are safe.

Two guards run before the publish step, because a tag can point anywhere: the tagged commit must be
reachable from `main` (`scripts/check-release-tag.sh`), and the tag name must match the version in
`package.json`. A tag on an unmerged branch, or `v0.1.2` on a `0.1.1` tree, fails the run instead of
reaching the registry.
