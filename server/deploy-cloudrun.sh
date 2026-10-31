#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-crafty-joy-d6d0h}"
REGION="${REGION:-asia-southeast2}"

cd "$(dirname "$0")/.."

gcloud config set project "$PROJECT" >/dev/null

if ! gcloud secrets describe gate-secret >/dev/null 2>&1; then
  echo "missing Secret Manager entry: gate-secret" >&2
  echo "create it with: printf '%s' \"\$SECRET\" | gcloud secrets create gate-secret --data-file=-" >&2
  exit 2
fi

if ! gcloud secrets describe token-key-private >/dev/null 2>&1; then
  echo "missing Secret Manager entry: token-key-private" >&2
  echo "create it with: gcloud secrets create token-key-private --data-file=server/token-key-private.pem" >&2
  exit 2
fi

gcloud builds submit --config server/cloudbuild.yaml \
  --substitutions "_REGION=${REGION},_SERVICE=suppresor-gate" .

echo "deployed. set SUPPRESOR_GATE_URL to the Cloud Run URL in the plugin."
