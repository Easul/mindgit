#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="${root_dir}/dist"
compressed_web_dir="${root_dir}/temp/release-web"
version="${MINDGIT_VERSION:-$(git -C "${root_dir}" describe --tags --always --dirty)}"

cleanup() {
  rm -rf "${compressed_web_dir}"
}

trap cleanup EXIT

rm -rf "${dist_dir}"
mkdir -p "${dist_dir}"

rm -rf "${compressed_web_dir}"
mkdir -p "${compressed_web_dir}"

while IFS= read -r -d '' source; do
  relative="${source#"${root_dir}/web/"}"
  target="${compressed_web_dir}/${relative}.gz"
  mkdir -p "$(dirname "${target}")"
  gzip -9 -n -c "${source}" > "${target}"
done < <(find "${root_dir}/web" -type f -print0)

build() {
  local goos="$1"
  local goarch="$2"
  local artifact_arch="${3:-${goarch}}"
  local goarm="${4:-}"
  local binary="mindgit-${goos}-${artifact_arch}"
  local output="${dist_dir}/${binary}"

  if [[ "${goos}" == "windows" ]]; then
    output="${output}.exe"
  fi

  local -a build_env=("CGO_ENABLED=0" "GOOS=${goos}" "GOARCH=${goarch}")
  if [[ -n "${goarm}" ]]; then
    build_env+=("GOARM=${goarm}")
  fi

  env "${build_env[@]}" go build -tags=compressedassets -trimpath \
    -ldflags="-s -w -X main.version=${version}" \
    -o "${output}" "${root_dir}"
}

package() {
  local goos="$1"
  local artifact_arch="$2"
  local binary="mindgit-${goos}-${artifact_arch}"

  if [[ "${goos}" == "windows" ]]; then
    (cd "${dist_dir}" && zip -q "${binary}.zip" "${binary}.exe")
  else
    tar -C "${dist_dir}" -czf "${dist_dir}/${binary}.tar.gz" "${binary}"
  fi
}

build linux amd64
build linux arm armv7 7
build darwin amd64
build windows amd64
build android arm64

package linux amd64
package linux armv7
package darwin amd64
package windows amd64
package android arm64

(cd "${dist_dir}" && sha256sum mindgit-* > SHA256SUMS)
