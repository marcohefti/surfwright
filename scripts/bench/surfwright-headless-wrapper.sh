#!/usr/bin/env bash
set -euo pipefail

real_bin="${ZCL_BENCH_SURFWRIGHT_REAL_BIN:-}"
if [[ -z "${real_bin}" ]]; then
  echo "bench-headless-wrapper: ZCL_BENCH_SURFWRIGHT_REAL_BIN is required" >&2
  exit 64
fi

args=("$@")
for ((i=0; i<${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--browser-mode" ]] && (( i + 1 < ${#args[@]} )); then
    if [[ "${args[$((i+1))]}" == "headed" ]]; then
      args[$((i+1))]="headless"
    fi
  fi
done

exec "${real_bin}" "${args[@]}"
