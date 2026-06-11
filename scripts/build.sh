#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dist_dir="${root_dir}/dist"

rm -rf "${dist_dir}"
mkdir -p "${dist_dir}"

build() {
  local goos="$1"
  local goarch="$2"
  local binary="mindgit-${goos}-${goarch}"
  local output="${dist_dir}/${binary}"

  if [[ "${goos}" == "windows" ]]; then
    output="${output}.exe"
  fi

  CGO_ENABLED=0 GOOS="${goos}" GOARCH="${goarch}" \
    go build -trimpath -ldflags="-s -w" -o "${output}" "${root_dir}"
}

package() {
  local goos="$1"
  local goarch="$2"
  local binary="mindgit-${goos}-${goarch}"

  if [[ "${goos}" == "windows" ]]; then
    (cd "${dist_dir}" && zip -q "${binary}.zip" "${binary}.exe")
  else
    tar -C "${dist_dir}" -czf "${dist_dir}/${binary}.tar.gz" "${binary}"
  fi
}

build linux amd64
build darwin amd64
build windows amd64

package linux amd64
package darwin amd64
package windows amd64

(cd "${dist_dir}" && sha256sum mindgit-* > SHA256SUMS)
