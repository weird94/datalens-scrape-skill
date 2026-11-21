#!/bin/zsh
# Regression: rerun every saved playground config against the current scripts and grade them.
#   blind/  configs written by blind-test agents (graded against the playground answer keys)
#   dev/    configs used while developing the scripts (row count vs expected.json)
# Needs the fixture server: npm run serve (PORT=3031 tsx eval/serve.mts).
# PLAYWRIGHT_FROM: a folder whose node_modules has playwright (default: this repo's root).
# PORT: where the fixture server listens (default 3031); the saved configs are rewritten to it.
set -u
HERE=${0:A:h}
REPO=${HERE:h}
SKILL=$REPO/skill
OUT=${1:-$(mktemp -d)}
OUT=${OUT:A}
mkdir -p $OUT/blind $OUT/dev
export PLAYWRIGHT_FROM=${PLAYWRIGHT_FROM:-$REPO}
PORT=${PORT:-3031}
CFG=$(mktemp -d)
mkdir -p $CFG/blind $CFG/dev
for f in $HERE/blind/*.json; do sed "s#localhost:3031#localhost:$PORT#g" $f > $CFG/blind/${f:t}; done
for f in $HERE/dev/*.json; do sed "s#localhost:3031#localhost:$PORT#g" $f > $CFG/dev/${f:t}; done
cd $SKILL
for f in $CFG/blind/*.json; do node scripts/collect.mjs $f --out $OUT/blind/$(basename $f .json).csv > /dev/null 2>&1 & done
wait
for f in $CFG/dev/*.json; do node scripts/collect.mjs $f --out $OUT/dev/$(basename $f .json).csv > /dev/null 2>&1 & done
wait
node $HERE/grade.mjs $OUT/blind
echo "--- dev"
for f in $CFG/dev/*.json; do
  id=$(basename $f .json)
  exp=$(node -e "console.log(require('$HERE/playground/cases/$id/expected.json').expectedRows)")
  got=$(($(wc -l < $OUT/dev/$id.csv) - 1))
  # The dev configs are the right ones: any expand warning on them is a false alarm in the engine.
  flags=$(node -e "const s=require('$OUT/dev/$id.json');const on=['expand','expandNoEffect','expandMissed','expandPastStart','expandReplaced'].filter(k=>s[k]);console.log(on.length?' WARNED: '+on.join(','):'')")
  echo "$id $got/$exp $(node -e "console.log(require('$OUT/dev/$id.json').stopReason)")$flags"
done
echo "outputs: $OUT"
