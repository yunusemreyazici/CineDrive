#!/usr/bin/env bash
# Called only by the tag-gated publish job after all native builds succeed.
set -euo pipefail

: "${IMAGE:?}" "${METADATA:?}" "${DIGEST_DIR:?}" "${RUNNER_TEMP:?}" "${GITHUB_OUTPUT:?}"
[[ "$IMAGE" =~ ^ghcr\.io/yunusemreyazici/cinedrive-(server|web)$ ]]

# download-artifact is scoped to this workflow run; do not accept one platform,
# extra files, or a digest string that could be interpreted as CLI arguments.
shopt -s nullglob dotglob
files=("$DIGEST_DIR"/*)
[[ ${#files[@]} == 2 ]]
amd64="$(<"$DIGEST_DIR/digest-amd64.txt")"
arm64="$(<"$DIGEST_DIR/digest-arm64.txt")"
[[ "$amd64" =~ ^sha256:[0-9a-f]{64}$ && "$arm64" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$amd64" != "$arm64" ]]
sources=("${IMAGE}@${amd64}" "${IMAGE}@${arm64}")

tag_lines="$(jq -er '.tags | select(type == "array" and length > 0 and all(.[]; type == "string")) | .[]' <<< "$METADATA")"
tags=()
while IFS= read -r tag; do
  [[ "$tag" == "$IMAGE:"* ]]
  suffix="${tag#"$IMAGE:"}"
  [[ "$suffix" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]
  tags+=(--tag "$tag")
done <<< "$tag_lines"
[[ ${#tags[@]} -gt 0 ]]

validate_index() {
  jq -e --arg amd64 "$amd64" --arg arm64 "$arm64" '
    .schemaVersion == 2 and
    (.manifests | type == "array" and length == 2) and
    ([.manifests[] | select(.platform.os == "linux" and
      .platform.architecture == "amd64" and .digest == $amd64)] | length == 1) and
    ([.manifests[] | select(.platform.os == "linux" and
      .platform.architecture == "arm64" and .digest == $arm64)] | length == 1)
  ' "$1" > /dev/null
}

# Resolve both source descriptors before moving any public version tags.
docker buildx imagetools create --dry-run "${sources[@]}" > "$RUNNER_TEMP/image-index.json"
validate_index "$RUNNER_TEMP/image-index.json"
docker buildx imagetools create --metadata-file "$RUNNER_TEMP/image-index-metadata.json" \
  "${tags[@]}" "${sources[@]}"
digest="$(jq -er '."containerimage.descriptor".digest' "$RUNNER_TEMP/image-index-metadata.json")"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]

# Attest/sign the immutable combined index, never a mutable tag or one platform.
docker buildx imagetools inspect --raw "${IMAGE}@${digest}" > "$RUNNER_TEMP/published-index.json"
validate_index "$RUNNER_TEMP/published-index.json"
printf 'digest=%s\n' "$digest" >> "$GITHUB_OUTPUT"
